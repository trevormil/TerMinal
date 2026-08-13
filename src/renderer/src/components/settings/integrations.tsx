import { useState } from 'react'
import { CircleCheck, ClipboardCopy, Loader2, PlugZap, RotateCcw, TerminalSquare } from 'lucide-react'
import { Section, tilde, type SettingsCtx, type SettingsSectionSpec } from './shared'

function Component({ ctx }: { ctx: SettingsCtx }) {
  const { onRerunSetup } = ctx

  const [copied, setCopied] = useState(false)
  const copySetupPrompt = async () => {
    const prompt = [
      'I just installed TerMinal (an Electron alt-terminal for AI coding agents).',
      'Help me finish one-time setup on this machine. Check what already exists before changing anything.',
      '',
      '1. CLIs: ensure `claude` (required) is installed + logged in, plus any of `codex`, `gh`, `glab` I plan to use. Walk me through `gh auth login` / `glab auth login` if needed.',
      '2. Global agent skills: nothing to install for Claude Code — TerMinal already installed its tm plugin (~/.claude/skills/tm; /tm:ticket, /tm:code-review, …) and synced tm-* skills into ~/.codex/skills. Just verify `/tm:` skills resolve in a fresh claude session (Settings → Updates → Sync repairs them).',
      '3. (Optional) Telegram: help me create a bot with @BotFather and find my numeric chat id, so I can paste the token + id into TerMinal → Settings → Telegram.',
      '',
      'Summarize what you did and what is left for me.',
    ].join('\n')
    await window.gt.clipboardWrite(prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const [notify, setNotify] = useState<{ busy?: boolean; ok?: boolean; path?: string; error?: string } | null>(
    null,
  )
  const installNotify = async () => {
    setNotify({ busy: true })
    setNotify(await window.gt.installGtNotify())
  }

  const [mcpState, setMcpState] = useState<{
    busy?: boolean
    ok?: boolean
    installed?: string[]
    error?: string
  } | null>(null)
  const installMcp = async () => {
    setMcpState({ busy: true })
    const r = await window.gt.mcpInstall()
    if ('error' in r) setMcpState({ error: r.error })
    else setMcpState({ ok: true, installed: r.installed })
  }

  return (
    <Section
      id="integrations"
      icon={PlugZap}
      title="Setup & integrations"
      desc="One-time helpers for a fresh machine. Agents inherit your global ~/.claude and ~/.codex config + skills."
    >
      <div className="space-y-2">
        <button
          onClick={copySetupPrompt}
          className="flex w-full items-center gap-2 rounded-lg border border-[var(--gt-border)] bg-black/20 px-3 py-2 text-left text-[12px] text-zinc-200 hover:border-[var(--gt-accent)]/40"
        >
          {copied ? (
            <CircleCheck size={14} strokeWidth={2} className="text-[var(--gt-green)]" />
          ) : (
            <ClipboardCopy size={14} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
          )}
          Copy global-skills setup prompt
          <span className="ml-auto text-[10.5px] text-zinc-600">
            {copied ? 'copied — paste into Claude' : 'paste into Claude'}
          </span>
        </button>
        <button
          onClick={installNotify}
          disabled={notify?.busy}
          className="flex w-full items-center gap-2 rounded-lg border border-[var(--gt-border)] bg-black/20 px-3 py-2 text-left text-[12px] text-zinc-200 hover:border-[var(--gt-accent)]/40 disabled:opacity-50"
        >
          {notify?.busy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <TerminalSquare size={14} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
          )}
          Install <span className="font-mono">gt-notify</span> to ~/.local/bin
          <span className="ml-auto text-[10.5px] text-zinc-600">Activity feed hook</span>
        </button>
        {notify && !notify.busy && (
          <div className={`text-[11px] ${notify.ok ? 'text-[var(--gt-green)]' : 'text-amber-400'}`}>
            {notify.ok ? `✓ Installed at ${tilde(notify.path || '')}` : notify.error}
          </div>
        )}
        <button
          onClick={installMcp}
          disabled={mcpState?.busy}
          className="flex w-full items-center gap-2 rounded-lg border border-[var(--gt-border)] bg-black/20 px-3 py-2 text-left text-[12px] text-zinc-200 hover:border-[var(--gt-accent)]/40 disabled:opacity-50"
        >
          {mcpState?.busy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <TerminalSquare size={14} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
          )}
          Install MCP server (Claude Code + Codex)
          <span className="ml-auto text-[10.5px] text-zinc-600">Cross-session views</span>
        </button>
        {mcpState && !mcpState.busy && (
          <div className={`text-[11px] ${mcpState.ok ? 'text-[var(--gt-green)]' : 'text-amber-400'}`}>
            {mcpState.ok
              ? `✓ Installed to ${mcpState.installed?.join(', ') || ''}. Restart any open Claude session to pick it up.`
              : mcpState.error}
          </div>
        )}
        <button
          onClick={onRerunSetup}
          className="flex w-full items-center gap-2 rounded-lg border border-[var(--gt-border)] bg-black/20 px-3 py-2 text-left text-[12px] text-zinc-200 hover:border-[var(--gt-accent)]/40"
        >
          <RotateCcw size={14} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
          Re-run first-time setup
        </button>
      </div>
    </Section>
  )
}

const section: SettingsSectionSpec = {
  id: 'integrations',
  title: 'Setup',
  icon: PlugZap,
  order: 16,
  Component,
}
export default section
