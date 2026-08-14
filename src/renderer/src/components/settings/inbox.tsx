import { Inbox } from 'lucide-react'
import { Section, Toggle, type SettingsCtx, type SettingsSectionSpec } from './shared'

function Component({ ctx }: { ctx: SettingsCtx }) {
  const { s, save } = ctx
  return (
    <Section
      id="inbox"
      icon={Inbox}
      title="Inbox"
      desc="Global human-needed queue. Manual blockers and cron failures always go here; completion hooks are configurable."
    >
      <div className="space-y-2">
        <Toggle
          on={s.inbox.completionHook}
          onToggle={() => save({ inbox: { completionHook: !s.inbox.completionHook } })}
          label="File completion hooks to Inbox"
          hint="Claude, Codex, and Cursor turns launched through TerMinal create review items when they complete."
        />
        <Toggle
          on={s.inbox.agentContextPreamble}
          onToggle={() => save({ inbox: { agentContextPreamble: !s.inbox.agentContextPreamble } })}
          label="Add repo context to prompt agents"
          hint="Prompt-style agent runs get a small capped preamble from docs/learnings, docs/decisions, and docs/runbooks. Script agents are unchanged."
        />
        <div className="rounded-md border border-[var(--gt-border)] bg-black/20 px-3 py-2">
          <div className="text-[11.5px] font-medium text-zinc-200">Notify me for</div>
          <div className="mt-0.5 text-[10.5px] text-zinc-500">
            Which severities send a notification (phone push · Telegram · desktop). Below the
            cutoff, items are inbox-only — email you sweep once or twice a day.
          </div>
          <div className="mt-2 flex gap-1">
            {(
              [
                ['urgent', 'Urgent only'],
                ['normal', 'Urgent + Normal'],
                ['low', 'Everything'],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                onClick={() => save({ inbox: { notifyThreshold: val } })}
                className={`rounded-md border px-2.5 py-1 text-[11px] ${
                  s.inbox.notifyThreshold === val
                    ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/20 text-zinc-100'
                    : 'border-[var(--gt-border)] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1.5 text-[10.5px] text-zinc-500">
          <div className="rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-1.5">
            <span className="block text-zinc-300">Urgent</span>
            <span>Human blockers, cron failures, daily cap reached</span>
          </div>
          <div className="rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-1.5">
            <span className="block text-zinc-300">Normal</span>
            <span>Spend warnings, recurring review-finding digests</span>
          </div>
          <div className="rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-1.5">
            <span className="block text-zinc-300">Low</span>
            <span>Post-completion review prompts</span>
          </div>
        </div>
      </div>
    </Section>
  )
}

const section: SettingsSectionSpec = {
  id: 'inbox',
  title: 'Inbox',
  icon: Inbox,
  order: 9,
  Component,
}
export default section
