import { appendFileSync } from 'node:fs'

// Loaded (in addition to src/test-preload.ts) by scripts/effect-canary.ts.
//
// The independent observer for outbound HTTP: it does not trust the effect
// guard, it watches the socket. Every non-loopback `fetch` the suite performs is
// recorded — that covers the Telegram Bot API, APNs and outbound webhooks.
// Loopback is excluded on purpose: the bridge tests stand up a real server on
// 127.0.0.1 and talk to it, which never leaves the machine.
//
// The other half of the canary — activity-feed appends — is checked by the
// runner, which points HOME at a throwaway dir and looks for a feed there.
const out = process.env.EFFECT_CANARY_OUT

function isLoopback(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
  } catch {
    return false
  }
}

if (out && !(globalThis as { __tmCanary?: boolean }).__tmCanary) {
  ;(globalThis as { __tmCanary?: boolean }).__tmCanary = true
  const realFetch = globalThis.fetch
  globalThis.fetch = ((input: unknown, init: unknown) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url)
    if (!isLoopback(url)) appendFileSync(out, `FETCH ${url}\n`)
    return realFetch(input as RequestInfo, init as RequestInit)
  }) as typeof fetch
}
