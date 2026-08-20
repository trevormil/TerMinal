import { useEffect, useState } from 'react'
import { ClipboardCopy, Eye, RefreshCw, Smartphone } from 'lucide-react'
import qrcode from 'qrcode-generator'
import type {
  BridgePairing,
  BridgePushStatus,
  BridgeStatus,
  BridgeTailscale,
  Settings,
  SettingsPatch,
} from '../../lib/types'
import { Section, Toggle, type SettingsCtx, type SettingsSectionSpec } from './shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// Pairing pane for the mobile bridge (TerMinal Remote for iOS). The QR carries
// the bearer token and the pinned cert fingerprint — it IS the credential in
// scannable form, so it stays hidden (with the text code) until the user
// explicitly reveals it, and is never persisted anywhere the renderer can leak
// it. The copyable text form exists because the iOS Simulator has no camera.
function MobileSection({
  cfg,
  save,
}: {
  cfg: Settings['bridge']
  save: (patch: SettingsPatch) => void
}) {
  const [status, setStatus] = useState<BridgeStatus | null>(null)
  const [pairing, setPairing] = useState<BridgePairing | null>(null)
  const [push, setPush] = useState<BridgePushStatus | null>(null)
  const [tailscale, setTailscale] = useState<BridgeTailscale | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  const refresh = () => {
    void window.gt.bridge.status().then(setStatus)
    if (cfg.enabled) {
      void window.gt.bridge.pairing().then(setPairing)
      void window.gt.bridge.pushStatus().then(setPush)
      void window.gt.bridge.tailscale().then(setTailscale)
    } else {
      setPairing(null)
      setPush(null)
      setTailscale(null)
    }
  }
  // Poll while enabled: a bind failure (port already taken) surfaces
  // asynchronously and would otherwise leave the pane claiming success.
  useEffect(() => {
    refresh()
    if (!cfg.enabled) return
    const t = setInterval(() => void window.gt.bridge.status().then(setStatus), 3000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.enabled, cfg.port])

  const payload = pairing ? JSON.stringify(pairing) : ''
  const qrSvg = (() => {
    if (!payload) return ''
    try {
      // typeNumber 0 = autosize; 'L' keeps the module count low enough for a
      // phone camera to lock on at this physical size.
      const qr = qrcode(0, 'L')
      qr.addData(payload)
      qr.make()
      return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })
    } catch {
      return ''
    }
  })()

  return (
    <Section
      id="mobile"
      icon={Smartphone}
      title="Mobile"
      desc="Drive your live terminals from the TerMinal Remote iOS app. Scan the code to pair a phone. Nothing binds a port until this is on."
    >
      <div className="space-y-3">
        <Toggle
          on={cfg.enabled}
          onToggle={() => save({ bridge: { enabled: !cfg.enabled } })}
          label="Enable mobile bridge"
          hint="Serves your live sessions over HTTPS on your LAN and tailnet. Every request needs the paired token."
        />

        {status?.error && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-400">
            {status.error}
          </div>
        )}

        {cfg.enabled && status?.listening && pairing && (
          <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
            {revealed ? (
              <div
                className="h-[168px] w-[168px] shrink-0 rounded-md bg-white p-2 [&>svg]:h-full [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
            ) : (
              <div className="flex h-[168px] w-[168px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--gt-border)] bg-black/20 text-center">
                <Eye size={18} strokeWidth={2} className="text-zinc-600" />
                <span className="px-3 text-[10.5px] leading-snug text-zinc-500">
                  QR hidden — Show pairing code to reveal
                </span>
              </div>
            )}
            <div className="min-w-0 space-y-2">
              <div className="text-[11px] text-zinc-400">
                Listening on port {status.port} as{' '}
                <span className="text-zinc-200">{pairing.n}</span>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                  Reachable at
                </span>
                {tailscale?.available && (
                  <div className="rounded-md border border-[var(--gt-accent-2)]/25 bg-[var(--gt-accent-2)]/10 px-2 py-1.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--gt-accent-2)]">
                      Tailscale — pair with no QR
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-zinc-300">
                      {tailscale.dnsName}
                    </div>
                    <div className="text-[10px] text-zinc-600">
                      On the phone: Pair over Tailscale → this name.
                    </div>
                  </div>
                )}
                {pairing.h.length ? (
                  pairing.h.map((h) => (
                    <div key={h} className="font-mono text-[11px] text-zinc-300">
                      {h}:{status.port}
                    </div>
                  ))
                ) : (
                  <div className="text-[11px] text-amber-400">
                    No network interface — connect to Wi-Fi or start Tailscale.
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    void window.gt.clipboardWrite(payload)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  }}
                >
                  <ClipboardCopy strokeWidth={2} />
                  {copied ? 'Copied' : 'Copy pairing code'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setRevealed((v) => !v)}
                >
                  <Eye strokeWidth={2} />
                  {revealed ? 'Hide' : 'Show'} pairing code
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    void window.gt.bridge.rotateToken().then((next) => {
                      setPairing(next)
                      setRevealed(false)
                    })
                  }}
                >
                  <RefreshCw strokeWidth={2} />
                  Rotate token
                </Button>
              </div>
              {revealed && (
                <textarea
                  readOnly
                  value={payload}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-20 w-full resize-none rounded-md border border-[var(--gt-border)] bg-black/40 p-2 font-mono text-[10px] text-zinc-400"
                />
              )}
              <div className="text-[10.5px] leading-relaxed text-zinc-600">
                The code contains the bearer token — treat it like a password. Copy pairing code
                places a working credential in your clipboard. Rotating the token disconnects every
                paired device.
              </div>
            </div>
          </div>
        )}

        {cfg.enabled && push && (
          <div className="rounded-md border border-[var(--gt-border)] bg-black/20 px-2.5 py-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-300">Push notifications</span>
              <span
                className={`text-[10.5px] ${push.configured ? 'text-[var(--gt-green)]' : 'text-zinc-500'}`}
              >
                {push.configured
                  ? `${push.devices} device${push.devices === 1 ? '' : 's'} registered`
                  : 'not configured'}
              </span>
            </div>
            <div className="mt-1 text-[10.5px] leading-relaxed text-zinc-600">
              {push.configured
                ? 'Alerts that reach Telegram also reach a paired iPhone.'
                : 'Create an APNs key in the Apple developer portal, then drop it next to the bridge identity.'}
            </div>
            {!push.configured && (
              <div className="mt-1.5 space-y-0.5 font-mono text-[10px] text-zinc-500">
                <div>{push.key}</div>
                <div>{push.config}</div>
              </div>
            )}
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
              Port
            </span>
            <Input
              type="number"
              defaultValue={cfg.port}
              onBlur={(e) => {
                const port = Number(e.target.value)
                if (Number.isInteger(port) && port >= 1024 && port <= 65535 && port !== cfg.port) {
                  save({ bridge: { port } })
                }
              }}
              className="h-8 w-28 font-mono text-[12px]"
            />
          </label>
          <div className="text-[10.5px] leading-relaxed text-zinc-600">
            Terminals only — the phone mirrors your desktop geometry and never resizes a session.
            Ask the agent itself about tickets, PRs, and CI.
          </div>
        </div>
      </div>
    </Section>
  )
}

function Component({ ctx }: { ctx: SettingsCtx }) {
  return <MobileSection cfg={ctx.s.bridge} save={ctx.save} />
}

const section: SettingsSectionSpec = {
  id: 'mobile',
  title: 'Mobile',
  icon: Smartphone,
  order: 10,
  Component,
}
export default section
