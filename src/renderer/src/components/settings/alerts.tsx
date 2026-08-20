import { useEffect, useState } from 'react'
import { BellRing, Loader2, Send } from 'lucide-react'
import type { AlertChannelId, DeliveryRecord } from '../../lib/types'
import { Button } from '@/components/ui/button'
import {
  Section,
  Toggle,
  WebhookList,
  type SettingsCtx,
  type SettingsSectionSpec,
} from './shared'

// Last-N alert deliveries with failure reasons. dispatchAlert isolates channel
// failures so one dead webhook can't block the others — which also meant a
// revoked token failed silently forever. This is where that becomes visible.
function DeliveryLog() {
  const [log, setLog] = useState<DeliveryRecord[] | null>(null)
  const [busy, setBusy] = useState(false)
  const load = async () => {
    setBusy(true)
    try {
      setLog(await window.gt.inbox.deliveryLog(undefined, 20))
    } catch {
      setLog([])
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="mt-4 border-t border-[var(--gt-border)] pt-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
          Recent deliveries
        </span>
        <Button
          type="button"
          variant="secondary"
          size="xs"
          onClick={load}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          Refresh
        </Button>
        <span className="text-[10.5px] text-zinc-600">
          Three consecutive failures on a channel file an Activity event.
        </span>
      </div>
      {log === null ? (
        <div className="text-[11px] text-zinc-600">Loading…</div>
      ) : log.length === 0 ? (
        <div className="text-[11px] text-zinc-600">
          No alerts dispatched yet — nothing to report.
        </div>
      ) : (
        <div className="space-y-1">
          {log.map((r, i) => (
            <div key={i} className="flex items-baseline gap-2 text-[11px]">
              <span className="w-16 shrink-0 tabular-nums text-zinc-600">
                {new Date(r.ts).toLocaleTimeString()}
              </span>
              <span className="w-16 shrink-0 font-mono text-zinc-400">{r.channel}</span>
              <span
                className={`w-4 shrink-0 ${r.ok ? 'text-[var(--gt-green)]' : 'text-[var(--gt-red)]'}`}
              >
                {r.ok ? '✓' : '✗'}
              </span>
              <span className="min-w-0 flex-1 truncate text-zinc-500" title={r.error || r.title}>
                {r.error ? <span className="text-amber-400">{r.error}</span> : r.title}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Component({ ctx }: { ctx: SettingsCtx }) {
  const { s, save } = ctx
  // Keyed by channel, except webhooks — there can be several, so each
  // destination gets its own `webhook:<id>` slot and its own result line.
  const [alertTest, setAlertTest] = useState<
    Record<string, { busy?: boolean; ok?: boolean; error?: string; note?: string } | undefined>
  >({})
  const testAlert = async (channel: AlertChannelId, webhookId?: string) => {
    const key = webhookId ? `webhook:${webhookId}` : channel
    setAlertTest((p) => ({ ...p, [key]: { busy: true } }))
    const r = await window.gt.alerts.test(channel, webhookId)
    setAlertTest((p) => ({ ...p, [key]: r }))
  }

  return (
    <Section
      id="alerts"
      icon={BellRing}
      title="Alert channels"
      desc="Turn each channel on/off and test it. What each channel actually fires for is set below in Notification routing; a failing channel never blocks the others."
    >
      <div className="space-y-3">
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <Toggle
              on={s.alerts.desktop.enabled}
              onToggle={() => save({ alerts: { desktop: { enabled: !s.alerts.desktop.enabled } } })}
              label="Desktop notifications"
              hint="Native macOS notification banners"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => testAlert('desktop')}
              disabled={alertTest.desktop?.busy}
              aria-busy={alertTest.desktop?.busy || undefined}
            >
              {alertTest.desktop?.busy ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Send strokeWidth={2} />
              )}
              Test
            </Button>
          </div>
          {alertTest.desktop && !alertTest.desktop.busy && (
            <div
              className={`text-[11px] ${alertTest.desktop.ok ? 'text-[var(--gt-green)]' : 'text-amber-400'}`}
            >
              {alertTest.desktop.ok
                ? // A `note` means it "succeeded" with a caveat — on an
                  // unsigned macOS build the OS accepts the call and
                  // shows nothing, so a bare "✓ Sent" would be a lie.
                  alertTest.desktop.note || '✓ Sent — check your notifications.'
                : alertTest.desktop.error}
            </div>
          )}
        </div>
        <WebhookList
          webhooks={s.alerts.webhooks}
          secretsSet={s.secretsSet}
          matrix={s.notifications.matrix}
          save={(webhooks) => save({ alerts: { webhooks } })}
          test={testAlert}
          results={alertTest}
        />
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <Toggle
              on={s.telegram.notify}
              onToggle={() => save({ telegram: { notify: !s.telegram.notify } })}
              label="Telegram"
              hint="Bot token, chat id and AFK control live in the Telegram section below"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => testAlert('telegram')}
              disabled={alertTest.telegram?.busy}
              aria-busy={alertTest.telegram?.busy || undefined}
            >
              {alertTest.telegram?.busy ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Send strokeWidth={2} />
              )}
              Test
            </Button>
          </div>
          {alertTest.telegram && !alertTest.telegram.busy && (
            <div
              className={`text-[11px] ${alertTest.telegram.ok ? 'text-[var(--gt-green)]' : 'text-amber-400'}`}
            >
              {alertTest.telegram.ok ? '✓ Sent — check your chat.' : alertTest.telegram.error}
            </div>
          )}
        </div>
        <DeliveryLog />
      </div>
    </Section>
  )
}

const section: SettingsSectionSpec = {
  id: 'alerts',
  title: 'Alerts',
  icon: BellRing,
  order: 12,
  Component,
}
export default section
