// Mobile-bridge IPC (ticket 0122 index.ts decomposition) — the Settings pane's
// view of the bridge: listening state, the pairing payload, push + tailscale
// status, and token rotation.
//
// Binding and unbinding the socket is NOT here: that is driven by the settings
// write path and by startup, both of which live in index.ts.

import { handle } from '../typed-ipc'
import { emitActivity } from '../events'
import { readSettings } from '../settings'
import { bridgeStatus } from '../bridge/server'
import { ensureIdentity, pairingPayload, rotateToken } from '../bridge/identity'
import { tailscaleSelf } from '../bridge/tailscale'
import { apnsPaths, pushStatus } from '../bridge/push'

export function registerBridgeIpc(): void {
  handle('bridge:status', () => {
    const cfg = readSettings().bridge
    const status = bridgeStatus()
    return { ...status, enabled: cfg.enabled, port: cfg.enabled ? status.port : cfg.port }
  })
  // The pairing payload carries the bearer token, so it is only ever produced on
  // demand for the Settings pane — never returned from a bridge HTTP route.
  handle('bridge:pairing', () => {
    const cfg = readSettings().bridge
    const identity = ensureIdentity()
    return pairingPayload({ port: cfg.port, identity })
  })
  handle('bridge:push-status', () => ({ ...pushStatus(), ...apnsPaths() }))
  handle('bridge:tailscale', async () => {
    const self = await tailscaleSelf()
    return self
      ? { available: true, dnsName: self.dnsName, login: self.login }
      : { available: false }
  })
  handle('bridge:rotate-token', () => {
    const cfg = readSettings().bridge
    const identity = rotateToken()
    emitActivity({
      kind: 'info',
      title: 'Mobile bridge token rotated',
      detail: 'Every paired device must scan the new code',
    })
    return pairingPayload({ port: cfg.port, identity })
  })
}
