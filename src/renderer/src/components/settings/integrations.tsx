import { useState } from 'react'
import {
  CircleCheck,
  ClipboardCopy,
  Loader2,
  PlugZap,
  RotateCcw,
  TerminalSquare,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
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

  const [notify, setNotify] = useState<{
    busy?: boolean
    ok?: boolean
    path?: string
    error?: string
  } | null>(null)
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
        <Button
          type="button"
          variant="secondary"
          className="w-full justify-start"
          onClick={copySetupPrompt}
        >
          {copied ? (
            <CircleCheck strokeWidth={2} className="text-[var(--gt-green)]" />
          ) : (
            <ClipboardCopy strokeWidth={2} className="text-[var(--gt-accent-light)]" />
          )}
          <span className="font-normal">Copy global-skills setup prompt</span>
          <span className="ml-auto text-[10.5px] font-normal text-zinc-600">
            {copied ? 'copied — paste into Claude' : 'paste into Claude'}
          </span>
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="w-full justify-start"
          onClick={installNotify}
          disabled={notify?.busy}
          aria-busy={notify?.busy || undefined}
        >
          {notify?.busy ? (
            <Loader2 className="animate-spin" />
          ) : (
            <TerminalSquare strokeWidth={2} className="text-[var(--gt-accent-light)]" />
          )}
          <span className="font-normal">
            Install <span className="font-mono">gt-notify</span> to ~/.local/bin
          </span>
          <span className="ml-auto text-[10.5px] font-normal text-zinc-600">
            Activity feed hook
          </span>
        </Button>
        {notify && !notify.busy && (
          <div className={`text-[11px] ${notify.ok ? 'text-[var(--gt-green)]' : 'text-amber-400'}`}>
            {notify.ok ? `✓ Installed at ${tilde(notify.path || '')}` : notify.error}
          </div>
        )}
        <Button
          type="button"
          variant="secondary"
          className="w-full justify-start"
          onClick={installMcp}
          disabled={mcpState?.busy}
          aria-busy={mcpState?.busy || undefined}
        >
          {mcpState?.busy ? (
            <Loader2 className="animate-spin" />
          ) : (
            <TerminalSquare strokeWidth={2} className="text-[var(--gt-accent-light)]" />
          )}
          <span className="font-normal">Install MCP server (Claude Code + Codex)</span>
          <span className="ml-auto text-[10.5px] font-normal text-zinc-600">
            Cross-session views
          </span>
        </Button>
        {mcpState && !mcpState.busy && (
          <div
            className={`text-[11px] ${mcpState.ok ? 'text-[var(--gt-green)]' : 'text-amber-400'}`}
          >
            {mcpState.ok
              ? `✓ Installed to ${mcpState.installed?.join(', ') || ''}. Restart any open Claude session to pick it up.`
              : mcpState.error}
          </div>
        )}
        <Button
          type="button"
          variant="secondary"
          className="w-full justify-start"
          onClick={onRerunSetup}
        >
          <RotateCcw strokeWidth={2} className="text-[var(--gt-accent-light)]" />
          <span className="font-normal">Re-run first-time setup</span>
        </Button>
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
