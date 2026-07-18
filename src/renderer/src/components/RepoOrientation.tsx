import { useEffect, useState } from 'react'
import {
  Bot,
  CalendarClock,
  CircleCheck,
  CircleDashed,
  ClipboardList,
  History,
  Loader2,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Engine, TabContext, TicketProviderKind } from '../lib/types'
import { navigateTo } from '../lib/nav'
import { openPromptInTerminal, remoteForTabContext } from '../lib/launch'

// Per-repo orientation: what each core tab is for in THIS repo, with live
// found/missing status from TabContext — plus the two setup actions that are
// per-repo decisions: bootstrap (seed .agents/ + workflow files) and the
// ticket provider. Auto-shows once for fresh repos (no agents, no backlog —
// see shouldAutoShowRepoOrientation) and on demand from the ⌘K palette.
// Closing it persists the per-repo dismissal via onClose.

const PROVIDERS: TicketProviderKind[] = ['local', 'github', 'linear', 'obsidian']

// The lay-of-the-land prompt seeded into a fresh session by the CTA.
const FIRST_PROMPT =
  "Look around this repo and give me the lay of the land: what it does, how it's structured, how to run and test it, and anything unusual I should know before making changes."

function Row({
  icon: Icon,
  name,
  present,
  text,
  onOpen,
  children,
}: {
  icon: LucideIcon
  name: string
  present: boolean | null
  text: string
  onOpen?: () => void
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      {present === null ? (
        <span className="mt-0.5 w-[15px] shrink-0" />
      ) : present ? (
        <CircleCheck size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-[var(--gt-green)]" />
      ) : (
        <CircleDashed size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-zinc-600" />
      )}
      <Icon size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-[var(--gt-accent-light)]" />
      <div className="min-w-0 flex-1">
        <span className="text-[12.5px] font-semibold text-zinc-200">{name}</span>
        <span className="ml-2 text-[12px] text-zinc-500">{text}</span>
        {children}
      </div>
      {onOpen && (
        <button
          onClick={onOpen}
          className="shrink-0 rounded-md border border-[var(--gt-border)] px-2 py-0.5 text-[10.5px] text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200"
        >
          Open
        </button>
      )}
    </div>
  )
}

export function RepoOrientation({ ctx, onClose }: { ctx: TabContext; onClose: () => void }) {
  const [bootstrap, setBootstrap] = useState<
    'unknown' | 'needed' | 'ok' | 'confirm' | 'running' | 'done' | 'error'
  >('unknown')
  const [bootstrapError, setBootstrapError] = useState('')
  const [templateSha, setTemplateSha] = useState('')
  const [provider, setProvider] = useState<TicketProviderKind>(ctx.ticketProvider)
  const [providerBusy, setProviderBusy] = useState(false)
  const [defaultEngine, setDefaultEngine] = useState<Engine>('codex')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  useEffect(() => {
    let alive = true
    if (!ctx.remote)
      window.gt.workspace.isBootstrapped(ctx.repoRoot).then((r) => {
        if (alive) setBootstrap(r.bootstrapped ? 'ok' : 'needed')
      })
    window.gt.settings.get().then((s) => {
      if (alive) setDefaultEngine(s.defaultEngine)
    })
    return () => {
      alive = false
    }
  }, [ctx.repoRoot, ctx.remote])

  const repoName = ctx.repoRoot.split('/').filter(Boolean).pop() || ctx.repoRoot
  const open = (tabId: string) => {
    navigateTo(tabId)
    onClose()
  }

  const runBootstrap = async () => {
    setBootstrap('running')
    const r = await window.gt.workspace.bootstrap(ctx.repoRoot)
    if ('error' in r) {
      setBootstrapError(r.error)
      setBootstrap('error')
    } else {
      setTemplateSha(r.templateSha || '')
      setBootstrap('done')
    }
  }

  // Per-repo source of truth for tickets. Non-local providers usually need
  // more config (labels, MCP, vault) — deep-link to Settings → Tickets for it.
  const pickProvider = async (kind: TicketProviderKind) => {
    if (providerBusy || kind === provider) return
    setProviderBusy(true)
    try {
      const cfg = await window.gt.tickets.providerGet()
      const saved = await window.gt.tickets.providerSave({
        ...('error' in cfg ? {} : cfg),
        provider: kind,
      })
      if (!('error' in saved)) {
        setProvider(kind)
        window.dispatchEvent(new Event('gt.ticket-provider.changed'))
      }
    } finally {
      setProviderBusy(false)
    }
  }

  const askAgent = () => {
    openPromptInTerminal({
      engine: defaultEngine,
      cwd: ctx.repoRoot,
      name: 'orient',
      prompt: FIRST_PROMPT,
      remote: remoteForTabContext(ctx),
    })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-5"
      onClick={onClose}
    >
      <div
        className="w-[580px] max-w-full rounded-2xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[15px] font-bold tracking-tight text-zinc-100">
            <span className="gt-grad-text">{repoName}</span> in TerMinal
          </h2>
          <button
            onClick={onClose}
            title="Got it — don't show this again for this repo"
            className="rounded-md p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
          >
            <X size={13} strokeWidth={2.5} />
          </button>
        </div>
        <p className="mb-4 text-[12px] text-zinc-500">
          What each tab does in this repo, and what makes it fill in.
        </p>

        <div className="mb-5 space-y-3">
          {bootstrap !== 'unknown' && (
            <Row
              icon={Wrench}
              name="Setup"
              present={bootstrap === 'ok' || bootstrap === 'done'}
              text={
                bootstrap === 'ok'
                  ? 'Bootstrapped — agents, skills, and workflow files are seeded.'
                  : bootstrap === 'done'
                    ? `Bootstrapped${templateSha ? ` (template ${templateSha.slice(0, 7)})` : ''} — reload tabs to pick up .agents/ + skills.`
                    : bootstrap === 'running'
                      ? 'Running bootstrap.sh…'
                      : bootstrap === 'error'
                        ? `Bootstrap failed: ${bootstrapError}`
                        : 'Not bootstrapped — seeds .agents/, skills, tickets, and workflow files.'
              }
            >
              {(bootstrap === 'needed' || bootstrap === 'confirm') && (
                <div className="mt-1.5 flex items-center gap-2">
                  {bootstrap === 'confirm' ? (
                    <>
                      <span className="text-[11px] text-amber-300">
                        Runs project-template/bootstrap.sh — existing files kept, conflicts saved as
                        *.workflow sidecars.
                      </span>
                      <button
                        onClick={runBootstrap}
                        className="rounded-md border border-[var(--gt-accent)]/60 bg-[var(--gt-accent)]/20 px-2 py-0.5 text-[10.5px] font-semibold text-zinc-100 hover:bg-[var(--gt-accent)]/30"
                      >
                        Run
                      </button>
                      <button
                        onClick={() => setBootstrap('needed')}
                        className="rounded-md border border-[var(--gt-border)] px-2 py-0.5 text-[10.5px] text-zinc-400 hover:text-zinc-200"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setBootstrap('confirm')}
                      className="rounded-md border border-[var(--gt-accent)]/60 bg-[var(--gt-accent)]/20 px-2 py-0.5 text-[10.5px] font-semibold text-zinc-100 hover:bg-[var(--gt-accent)]/30"
                    >
                      Bootstrap…
                    </button>
                  )}
                </div>
              )}
              {bootstrap === 'running' && (
                <Loader2 size={12} className="mt-1.5 animate-spin text-zinc-500" />
              )}
            </Row>
          )}
          <Row
            icon={ClipboardList}
            name="Tickets"
            present={ctx.hasBacklog}
            text={
              ctx.hasBacklog
                ? `Backlog ready (${ctx.ticketProviderLabel}). Agents pick work up from here.`
                : 'No backlog yet — file the first ticket and agents can pick it up.'
            }
            onOpen={() => open('tickets')}
          >
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[10.5px] text-zinc-600">Source:</span>
              {PROVIDERS.map((k) => (
                <button
                  key={k}
                  onClick={() => pickProvider(k)}
                  disabled={providerBusy}
                  className={`rounded-md border px-2 py-0.5 text-[10.5px] capitalize ${
                    provider === k
                      ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
                      : 'border-[var(--gt-border)] text-zinc-500 hover:text-zinc-200'
                  } disabled:opacity-50`}
                >
                  {k}
                </button>
              ))}
              {provider !== 'local' && (
                <button
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent('gt.settings.open', { detail: { section: 'tickets' } }),
                    )
                    onClose()
                  }}
                  className="text-[10.5px] text-[var(--gt-accent-light)] hover:underline"
                >
                  finish config in Settings →
                </button>
              )}
            </div>
          </Row>
          <Row
            icon={Bot}
            name="Agents"
            present={ctx.hasAgents}
            text={
              ctx.hasAgents
                ? 'Agent roster found (.agents/) — these own tickets and schedules.'
                : 'No agents yet — Bootstrap above seeds a starter roster.'
            }
            onOpen={() => open('agents')}
          />
          <Row
            icon={History}
            name="Runs"
            present={null}
            text="Fills in as agents execute — every run lands here with its log."
          />
          <Row
            icon={CalendarClock}
            name="Schedules"
            present={null}
            text="Recurring agent runs on real launchd jobs — set one up when an agent earns it."
            onOpen={() => open('schedules')}
          />
        </div>

        {/* first move: seed a session that maps the repo */}
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-[var(--gt-accent)]/35 bg-[var(--gt-accent)]/10 px-3 py-2.5">
          <Sparkles size={14} strokeWidth={2} className="shrink-0 text-[var(--gt-accent-light)]" />
          <span className="min-w-0 flex-1 text-[11.5px] text-zinc-300">
            <span className="font-semibold text-zinc-100">First move:</span> have the agent map the
            repo before you change anything.
          </span>
          <button
            onClick={askAgent}
            className="shrink-0 rounded-md border border-[var(--gt-accent)]/60 bg-[var(--gt-accent)]/20 px-2.5 py-1 text-[11px] font-semibold text-zinc-100 hover:bg-[var(--gt-accent)]/30"
          >
            Ask the agent
          </button>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[10.5px] text-zinc-600">
            Reopen anytime: ⌘K → "Repo orientation"
          </span>
          <button
            onClick={onClose}
            className="rounded-lg bg-[var(--gt-accent)] px-4 py-2 text-[12.5px] font-semibold text-white hover:opacity-90"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
