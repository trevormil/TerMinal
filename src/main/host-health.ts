// Host health checks (#20). Hosts go unreachable routinely — tailscale reauth
// (~every 24h), the box asleep, VPN down — so `ssh <host>` fails. This classifies
// the failure into an actionable reason + hint and probes reachability, so the UI
// degrades gracefully ("reauth tailscale?") instead of surfacing a raw ssh error
// or hanging.

import { execFile } from 'node:child_process'
import { isSafeSshTarget } from './remote'

export type HealthReason = 'timeout' | 'auth' | 'dns' | 'refused' | 'unknown'
export type SshClassification = { reason: HealthReason; hint: string }

const HINTS: Record<HealthReason, string> = {
  timeout: 'Host unreachable — VPN/tailscale down or reauth needed, or the box is asleep. Check the connection.',
  auth: 'SSH auth failed — key not accepted or host key changed. Check your SSH config / known_hosts.',
  dns: 'Host name did not resolve — is the host up and the tailscale/DNS name correct?',
  refused: 'Connection refused — the host is reachable but sshd is not accepting connections (service down?).',
  unknown: 'Host operation failed. Check the SSH connection to this host.',
}

// Map ssh failure text → reason + hint. Pure; the ordering matters (timeout and
// refused both mention "connect to host", so match the specific phrases).
export function classifySshError(stderr: string): SshClassification {
  const s = (stderr || '').toLowerCase()
  let reason: HealthReason = 'unknown'
  if (/timed out|timeout|operation timed out/.test(s)) reason = 'timeout'
  else if (/permission denied|host key verification failed|too many authentication|no matching|publickey/.test(s)) reason = 'auth'
  else if (/could not resolve|name or service not known|nodename nor servname|no address associated/.test(s)) reason = 'dns'
  else if (/connection refused/.test(s)) reason = 'refused'
  return { reason, hint: HINTS[reason] }
}

export type HostHealth = {
  reachable: boolean
  latencyMs?: number
  reason?: HealthReason
  hint?: string
}

// Probe a host with a short-timeout `ssh … true`. Returns reachability + latency,
// or a classified reason/hint on failure. `connectTimeoutSec` bounds the wait so a
// dead host can't hang the caller.
export function checkHostHealth(sshTarget: string, connectTimeoutSec = 6): Promise<HostHealth> {
  return new Promise((resolve) => {
    if (!isSafeSshTarget(sshTarget)) {
      return resolve({ reachable: false, reason: 'unknown', hint: 'Invalid SSH target.' })
    }
    const started = Date.now()
    execFile(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', `ConnectTimeout=${connectTimeoutSec}`, sshTarget, 'true'],
      { timeout: (connectTimeoutSec + 2) * 1000 },
      (err, _stdout, stderr) => {
        if (!err) return resolve({ reachable: true, latencyMs: Date.now() - started })
        const c = classifySshError(stderr || (err as Error).message || '')
        resolve({ reachable: false, reason: c.reason, hint: c.hint })
      },
    )
  })
}
