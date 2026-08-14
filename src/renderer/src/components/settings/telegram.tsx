import { useState } from 'react'
import { Loader2, MessageCircle, Send } from 'lucide-react'
import {
  SecretInput,
  Section,
  Toggle,
  actionButton,
  type SettingsCtx,
  type SettingsSectionSpec,
} from './shared'

function Component({ ctx }: { ctx: SettingsCtx }) {
  const { s, save } = ctx
  const [tg, setTg] = useState<{ busy?: boolean; ok?: boolean; error?: string } | null>(null)
  const testTelegram = async () => {
    setTg({ busy: true })
    setTg(await window.gt.telegram.test())
  }

  return (
    <Section
      id="telegram"
      icon={MessageCircle}
      title="Telegram"
      desc="Create a bot with @BotFather, paste its token and your chat id. Leave blank to use the legacy ~/.claude scripts if present."
    >
      <div className="space-y-2">
        <Toggle
          on={s.telegram.notify}
          onToggle={() => save({ telegram: { notify: !s.telegram.notify } })}
          label="Mirror notifications to Telegram"
        />
        <Toggle
          on={s.telegram.control}
          onToggle={() => save({ telegram: { control: !s.telegram.control } })}
          label="Remote control (AFK)"
          hint="Launch/cancel agents by texting the bot"
        />
        <label className="block space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
            Bot token
          </span>
          <SecretInput
            set={!!s.secretsSet?.['telegram.botToken']}
            onSave={(v) => save({ telegram: { botToken: v } })}
            placeholder="123456:ABC-DEF..."
          />
        </label>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="block min-w-0 space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
              Chat id
            </span>
            <SecretInput
              set={!!s.secretsSet?.['telegram.chatId']}
              onSave={(v) => save({ telegram: { chatId: v } })}
              placeholder="Your numeric chat id"
            />
          </label>
          <button onClick={testTelegram} disabled={tg?.busy} className={actionButton}>
            {tg?.busy ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Send size={13} strokeWidth={2} />
            )}
            Test
          </button>
        </div>
        {tg && !tg.busy && (
          <div className={`text-[11px] ${tg.ok ? 'text-[var(--gt-green)]' : 'text-amber-400'}`}>
            {tg.ok ? '✓ Sent — check your chat.' : tg.error}
          </div>
        )}
        {/*
          The old inline "that's the bot's own id" warning compared
          two values that `settings:get` now masks — and
          '••••••••'.split(':')[0] === '••••••••', so it was
          PERMANENTLY true: a false alarm for every configured user.
          The check lives in main instead, where it can see the real
          values: telegramChatIdError() runs on the Test button and
          maps Telegram's 403 to the same guidance.
        */}
        {s.telegram.control && (
          <details className="mt-1 rounded-md border border-[var(--gt-border)] bg-black/20 px-2.5 py-1.5">
            <summary className="cursor-pointer text-[11px] text-zinc-400 hover:text-zinc-200">
              Command reference (send /help in the chat)
            </summary>
            <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10.5px] text-zinc-500">
              <span className="col-span-2 text-[var(--gt-accent-light)]">
                /feature &lt;what you want built&gt; [@repo]
              </span>
              <span>/repos · /cd &lt;repo&gt;</span>
              <span>/sessions · /about</span>
              <span>/runs · /cancel &lt;n&gt;</span>
              <span>/tail &lt;id|n&gt;</span>
              <span>/agents [@repo]</span>
              <span>/run &lt;agent&gt; [opts]</span>
              <span>/tickets [@repo]</span>
              <span>/ticket &lt;slug|n&gt;</span>
              <span>/ticket new &lt;title&gt;</span>
              <span>/close &lt;slug|n&gt;</span>
              <span>/schedules</span>
              <span>/pause · /resume · /runnow</span>
              <span>/hitl · /resolve &lt;n|all&gt; · /reopen</span>
              <span>/mrs [@repo] · /mr &lt;iid&gt;</span>
              <span>/state &lt;agent&gt;</span>
              <span>/reset-state &lt;agent&gt;</span>
              <span>/bg [@repo] &lt;prompt&gt;</span>
              <span>/bg list · /bg cancel &lt;n&gt;</span>
              <span>/spend</span>
              <span>/status · /harness · /activity</span>
              <span>/install &lt;agent&gt;</span>
              <span>/rebuild</span>
            </div>
            <div className="mt-1.5 text-[10px] text-zinc-600">
              <span className="text-zinc-500">/feature</span> drafts a ticket from plain text, then
              offers a "Start work" button that builds it and links the PR back. Plain English works
              too — it's translated to a command. HITL pings include inline "Resolve" and "Tail run"
              buttons.
            </div>
          </details>
        )}
      </div>
    </Section>
  )
}

const section: SettingsSectionSpec = {
  id: 'telegram',
  title: 'Telegram',
  icon: MessageCircle,
  order: 14,
  Component,
}
export default section
