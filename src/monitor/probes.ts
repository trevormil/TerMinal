// The probes. One per monitor type, each reporting a `category` alongside its
// verdict. Two reasons for the category: the local-connectivity gate can only
// tell "our uplink died" from "their server died" by looking at WHICH layer
// failed, and an alert that says "HTTP 500" is actionable where "is down" is not.
import { spawnSync } from 'node:child_process'
import { resolve as dnsResolve, lookup as dnsLookup } from 'node:dns/promises'
import { connect as netConnect } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import {
  classifyCert,
  classifyCertTrust,
  classifyCommand,
  classifyHttp,
} from '../shared/monitor-classify'
import { categorizeError, categoryLabel, isOpaqueConnectFailure } from '../shared/monitor-flap'
import type { FailureCategory, ProbeResult, StoredMonitor } from './types'

const IP_LITERAL = /^(\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-f:]+\]?$/i

/**
 * Categorize a failed fetch, disambiguating Bun's opaque connect error with a
 * name lookup (see monitor-flap.ts:isOpaqueConnectFailure and ADR-0024 §24.4).
 *
 * The lookup only ever runs on the failure path of an already-failed request,
 * and only when the error itself said nothing useful — so a healthy cycle pays
 * nothing for it.
 */
export async function categorizeFetchError(url: string, err: unknown): Promise<FailureCategory> {
  const base = categorizeError(err)
  if (base !== 'unknown' || !isOpaqueConnectFailure(err)) return base
  let host = ''
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '')
  } catch {
    return 'unknown'
  }
  // An IP literal was never resolved, so a failure to connect to it can only be
  // their end refusing — there is no name that could have failed.
  if (!host || IP_LITERAL.test(host)) return 'refused'
  try {
    await dnsLookup(host)
    return 'refused'
  } catch (e) {
    const cat = categorizeError(e)
    return cat === 'unknown' ? 'dns' : cat
  }
}

/**
 * Per-probe deadline. Capped on purpose: a monitor configured with a 5-minute
 * timeout stacks against the tick interval and the confirm re-probe until a
 * cycle outlives the next one.
 */
const MAX_PROBE_TIMEOUT_MS = 60_000
export function probeTimeout(raw: unknown, fallback: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(MAX_PROBE_TIMEOUT_MS, Math.round(n))
}

const hostPort = (target: unknown): [string, number | undefined] => {
  const [host, portStr] = String(target).split(':')
  return [host, Number(portStr) || undefined]
}

async function probeHttp(m: StoredMonitor): Promise<ProbeResult> {
  const warnLatency = Number(m.config?.warnLatencyMs) || undefined
  const t0 = Date.now()
  let status: number | null = null
  let category: FailureCategory | undefined
  try {
    const res = await fetch(String(m.target), {
      method: (m.config?.method as string) || 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(probeTimeout(m.config?.timeoutMs, 10000)),
      headers: { 'user-agent': 'terminal-monitor/1.0' },
    })
    status = res.status
    const needle = m.config?.bodyContains
    if (needle) {
      const body = await res.text()
      if (!body.includes(String(needle)))
        return {
          status: 'fail',
          summary: `body missing "${needle}"`,
          metrics: { http: status },
          category: 'body',
        }
    }
  } catch (e) {
    status = null
    category = await categorizeFetchError(String(m.target), e)
  }
  const latencyMs = Date.now() - t0
  const state = classifyHttp(status, latencyMs, warnLatency)
  const summary =
    status === null
      ? `no response (${categoryLabel(category ?? 'unknown')})`
      : `HTTP ${status} · ${latencyMs}ms`
  return {
    status: state,
    summary,
    metrics: { http: status ?? 0, latencyMs },
    // A status code came back ⇒ their end answered, whatever it said.
    category: state === 'ok' ? undefined : (category ?? 'http-status'),
  }
}

function probeTls(m: StoredMonitor): Promise<ProbeResult> {
  const [host, parsedPort] = hostPort(m.target)
  const port = parsedPort ?? 443
  return new Promise<ProbeResult>((resolve) => {
    const socket = tlsConnect(
      { host, port, servername: host, rejectUnauthorized: false, timeout: 10000 },
      () => {
        const cert = socket.getPeerCertificate()
        // rejectUnauthorized stays false ON PURPOSE — you want to be told a cert
        // expires in 3 days even when the chain is already broken, and a
        // rejected handshake reports nothing at all. But the trust result was
        // then THROWN AWAY, so a self-signed / wrong-hostname / untrusted-issuer
        // cert rendered as a plain green "88d until expiry" (ticket 67 F-15).
        const authorized = socket.authorized === true
        const authError = socket.authorizationError ? String(socket.authorizationError) : ''
        socket.end()
        if (!cert || !cert.valid_to)
          return resolve({ status: 'fail', summary: 'no certificate', category: 'tls' })
        const days = Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86400000)
        const expiry = classifyCert(
          days,
          Number(m.config?.warnDays) || 15,
          Number(m.config?.critDays) || 5,
        )
        const state = classifyCertTrust(expiry, authorized)
        const issuer = cert.issuer?.O || 'issuer ?'
        resolve({
          status: state,
          summary: authorized
            ? `${days}d until expiry · ${issuer}`
            : `${days}d until expiry · ${issuer} · UNTRUSTED CHAIN (${authError || 'not authorized'})`,
          metrics: {
            daysRemaining: days,
            notAfter: cert.valid_to,
            authorized,
            authorizationError: authError,
          },
          category: state === 'ok' ? undefined : 'tls',
        })
      },
    )
    socket.on('error', (e: unknown) => {
      // A handshake that never got off the ground can be OUR network rather
      // than their certificate — the category has to reflect that.
      const category = categorizeError(e)
      resolve({
        status: 'fail',
        summary: `TLS handshake failed (${categoryLabel(category === 'unknown' ? 'tls' : category)})`,
        category: category === 'unknown' ? 'tls' : category,
      })
    })
    socket.on('timeout', () => {
      socket.destroy()
      resolve({ status: 'fail', summary: 'TLS timeout', category: 'timeout' })
    })
  })
}

function probeTcp(m: StoredMonitor): Promise<ProbeResult> {
  const [host, portStr] = String(m.target).split(':')
  const port = Number(portStr)
  return new Promise<ProbeResult>((resolve) => {
    const t0 = Date.now()
    const socket = netConnect({ host, port, timeout: 8000 }, () => {
      socket.end()
      resolve({
        status: 'ok',
        summary: `port ${port} open · ${Date.now() - t0}ms`,
        metrics: { latencyMs: Date.now() - t0 },
      })
    })
    socket.on('error', (e) => {
      const category = categorizeError(e)
      resolve({
        status: 'fail',
        summary: `port ${port} unavailable — ${categoryLabel(category)}`,
        category,
      })
    })
    socket.on('timeout', () => {
      socket.destroy()
      resolve({ status: 'fail', summary: `port ${port} timeout`, category: 'timeout' })
    })
  })
}

async function probeDns(m: StoredMonitor): Promise<ProbeResult> {
  const recordType = (m.config?.recordType as string) || 'A'
  try {
    // `dnsResolve` unions one return type per record type (SoaRecord is not even
    // an array). The probe only ever counts them and stringifies them, so the
    // union is collapsed rather than switched on.
    const recs = (await dnsResolve(String(m.target), recordType)) as unknown[]
    const expect = m.config?.expect
    if (expect && !recs.flat().map(String).includes(String(expect)))
      // The resolver answered — the answer is just wrong. That is their end,
      // and it must not vote for a local outage.
      return {
        status: 'fail',
        summary: `no ${recordType} record = ${expect}`,
        metrics: { records: recs.length },
        category: 'body',
      }
    return {
      status: 'ok',
      summary: `${recs.length} record(s)`,
      metrics: { records: recs.length },
    }
  } catch (e) {
    const category = categorizeError(e)
    return {
      status: 'fail',
      summary: `DNS resolution failed — ${categoryLabel(category === 'unknown' ? 'dns' : category)}`,
      category: category === 'unknown' ? 'dns' : category,
    }
  }
}

function probeCommand(m: StoredMonitor): ProbeResult {
  const r = spawnSync('/bin/bash', ['-lc', String(m.target)], {
    encoding: 'utf8',
    timeout: probeTimeout(m.config?.timeoutMs, 30000),
    maxBuffer: 4 * 1024 * 1024,
  })
  const out = (r.stdout || '').trim()
  let parsed: Record<string, unknown> | null = null
  try {
    const j: unknown = JSON.parse(out.split('\n').pop() || '')
    if (j && typeof j === 'object') parsed = j as Record<string, unknown>
  } catch {
    /* a check that prints prose rather than JSON is the normal case */
  }
  const status = classifyCommand(
    r.status ?? -1,
    typeof parsed?.status === 'string' ? parsed.status : undefined,
  )
  const summary =
    (parsed?.summary as string) ||
    out.split('\n').slice(-1)[0] ||
    (r.status === 0 ? 'exit 0' : `exit ${r.status}`)
  return {
    status,
    summary: String(summary).slice(0, 200),
    metrics: (parsed?.metrics as Record<string, unknown>) || { exitCode: r.status ?? -1 },
    detail: parsed?.detail,
    // A command monitor runs locally: whatever it reports, it is never
    // evidence that the operator's uplink is down.
    category: status === 'ok' ? undefined : 'command',
  }
}

export async function probe(m: StoredMonitor): Promise<ProbeResult> {
  switch (m.type) {
    case 'http':
      return probeHttp(m)
    case 'tls-cert':
      return probeTls(m)
    case 'tcp':
      return probeTcp(m)
    case 'dns':
      return probeDns(m)
    case 'command':
      return probeCommand(m)
    default:
      return { status: 'fail', summary: `unknown type ${m.type}`, category: 'unknown' }
  }
}
