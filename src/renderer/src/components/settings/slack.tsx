import { useState } from 'react'
import { Hash, Loader2, Send } from 'lucide-react'
import { slackChannelName } from '../../../../shared/slack'
import {
  SecretInput,
  Section,
  Toggle,
  actionButton,
  inp,
  type SettingsCtx,
  type SettingsSectionSpec,
} from './shared'

function Component({ ctx }: { ctx: SettingsCtx }) {
  const { s, save } = ctx
  const [sl, setSl] = useState<{ busy?: boolean; ok?: boolean; error?: string } | null>(null)
  const testSlack = async () => {
    setSl({ busy: true })
    setSl(await window.gt.slack.test())
  }

  return (
    <Section
      id="slack"
      icon={Hash}
      title="Slack"
      desc="Mirror Inbox filings to Slack — each category posts to its own channel. Needs a Slack app bot token (chat:write, channels:manage, reactions:write), not an incoming webhook."
    >
      <div className="space-y-2">
        <div className="rounded-md border border-[var(--gt-border)] bg-black/20 px-3 py-2">
          <div className="text-[11.5px] font-medium text-zinc-200">Inbox destination</div>
          <div className="mt-0.5 text-[10.5px] text-zinc-500">
            Where filings surface. Slack only still persists every item to the in-app Inbox
            (browsable, badge quiet) — Slack becomes the nag surface.
          </div>
          <div className="mt-2 flex gap-1">
            {(
              [
                ['inbox', 'Inbox only'],
                ['both', 'Inbox + Slack'],
                ['slack', 'Slack only'],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                onClick={() => save({ inbox: { destination: val } })}
                className={`rounded-md border px-2.5 py-1 text-[11px] ${
                  s.inbox.destination === val
                    ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/20 text-zinc-100'
                    : 'border-[var(--gt-border)] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {s.inbox.destination !== 'inbox' && !s.secretsSet?.['slack.botToken'] && (
            <div className="mt-1.5 text-[11px] text-amber-400">
              Slack posting is off until a bot token is set — filings currently reach only the
              in-app Inbox.
            </div>
          )}
        </div>
        <label className="block space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
            Bot token
          </span>
          <SecretInput
            set={!!s.secretsSet?.['slack.botToken']}
            onSave={(v) => save({ slack: { botToken: v } })}
            placeholder="xoxb-..."
          />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block min-w-0 space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
              Default channel
            </span>
            <input
              defaultValue={s.slack.defaultChannel}
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v !== s.slack.defaultChannel) void save({ slack: { defaultChannel: v } })
              }}
              placeholder="#terminal-inbox"
              spellCheck={false}
              className={`${inp} font-mono`}
            />
          </label>
          <label className="block min-w-0 space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
              Channel prefix
            </span>
            <input
              defaultValue={s.slack.channelPrefix}
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v !== s.slack.channelPrefix) void save({ slack: { channelPrefix: v } })
              }}
              placeholder="inbox"
              spellCheck={false}
              className={`${inp} font-mono`}
            />
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
            Auto-invite member ID
          </span>
          <input
            defaultValue={s.slack.inviteUserId}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v !== s.slack.inviteUserId) void save({ slack: { inviteUserId: v } })
            }}
            placeholder="U0ABC123DEF"
            spellCheck={false}
            className={`${inp} font-mono`}
          />
          <span className="block text-[10.5px] text-zinc-600">
            Your Slack member ID (Profile → three-dot menu → Copy member ID). Invited to every
            channel the bot creates, so new categories appear in your sidebar without a
            channel-browser hunt.
          </span>
        </label>
        <Toggle
          on={s.slack.autoCreateChannels}
          onToggle={() => save({ slack: { autoCreateChannels: !s.slack.autoCreateChannels } })}
          label="Auto-create channels"
          hint="Create + join a missing public channel on first post; off, unroutable posts fall back to the default channel."
        />
        <div className="flex items-center gap-2">
          <button onClick={testSlack} disabled={sl?.busy} className={actionButton}>
            {sl?.busy ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Send size={13} strokeWidth={2} />
            )}
            Test
          </button>
          {sl && !sl.busy && (
            <span className={`text-[11px] ${sl.ok ? 'text-[var(--gt-green)]' : 'text-amber-400'}`}>
              {sl.ok ? '✓ Posted — check the default channel.' : sl.error}
            </span>
          )}
        </div>
        <div className="text-[10.5px] text-zinc-600">
          Categories map to channels by slug — e.g. Monitoring/Certs →{' '}
          <span className="font-mono text-zinc-500">
            #{slackChannelName('Monitoring/Certs', s.slack)}
          </span>
          ; Uncategorized →{' '}
          <span className="font-mono text-zinc-500">#{slackChannelName(undefined, s.slack)}</span>.
          Recurrences thread under the original message; resolving adds a checkmark reaction.
        </div>
      </div>
    </Section>
  )
}

const section: SettingsSectionSpec = {
  id: 'slack',
  title: 'Slack',
  icon: Hash,
  order: 15,
  Component,
}
export default section
