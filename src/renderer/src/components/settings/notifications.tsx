import { BellDot } from 'lucide-react'
import {
  CATEGORY_META,
  CHANNEL_META,
  channelWants,
  NOTIFY_CATEGORIES,
  NOTIFY_CHANNELS,
  type NotifyCategory,
  type NotifyChannelId,
  type NotifyMatrix,
} from '../../../../shared/notifications'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Section, type SettingsCtx, type SettingsSectionSpec } from './shared'

// The category × channel routing grid. A checked cell = that channel fires for
// that category; effective state falls back to the shipped defaults per cell.
function NotificationMatrix({
  matrix,
  onToggle,
  onReset,
}: {
  matrix: NotifyMatrix
  onToggle: (ch: NotifyChannelId, cat: NotifyCategory) => void
  onReset: () => void
}) {
  return (
    <div className="space-y-2.5">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="w-full py-1.5 text-left" />
              {NOTIFY_CHANNELS.map((ch) => (
                <th
                  key={ch}
                  className="px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-zinc-400"
                >
                  {CHANNEL_META[ch].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NOTIFY_CATEGORIES.map((cat) => (
              <tr key={cat} className="border-t border-[var(--gt-border)]">
                <td className="py-1.5 pr-3">
                  <div className="text-[12px] font-medium text-zinc-200">
                    {CATEGORY_META[cat].label}
                  </div>
                  <div className="text-[10px] leading-tight text-zinc-600">
                    {CATEGORY_META[cat].desc}
                  </div>
                </td>
                {NOTIFY_CHANNELS.map((ch) => {
                  const on = channelWants(ch, cat, matrix)
                  const label = `${on ? 'Disable' : 'Enable'} ${CATEGORY_META[cat].label} → ${CHANNEL_META[ch].label}`
                  return (
                    <td key={ch} className="px-2 text-center">
                      <Checkbox
                        checked={on}
                        onCheckedChange={() => onToggle(ch, cat)}
                        title={label}
                        aria-label={label}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={onReset}
        className="text-zinc-500 hover:text-zinc-300"
      >
        Reset to defaults
      </Button>
    </div>
  )
}

function Component({ ctx }: { ctx: SettingsCtx }) {
  const { s, save } = ctx
  return (
    <Section
      id="notifications"
      icon={BellDot}
      title="Notification routing"
      desc="Which kinds of events reach which channel. The phone (Push) stays quiet by default — only things that need you and completions."
    >
      <NotificationMatrix
        matrix={s.notifications.matrix}
        onToggle={(ch, cat) => {
          const nextVal = !channelWants(ch, cat, s.notifications.matrix)
          const next: NotifyMatrix = {
            ...s.notifications.matrix,
            [ch]: { ...(s.notifications.matrix[ch] || {}), [cat]: nextVal },
          }
          void save({ notifications: { matrix: next } })
        }}
        onReset={() => save({ notifications: { matrix: {} } })}
      />
    </Section>
  )
}

const section: SettingsSectionSpec = {
  id: 'notifications',
  title: 'Routing',
  icon: BellDot,
  order: 13,
  Component,
}
export default section
