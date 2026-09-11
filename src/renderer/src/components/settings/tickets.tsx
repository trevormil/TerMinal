import { useEffect, useState } from 'react'
import {
  Activity,
  CircleAlert,
  CircleCheck,
  Loader2,
  Plus,
  RotateCcw,
  Send,
  Ticket as TicketIcon,
  Trash2,
} from 'lucide-react'
import type {
  TabContext,
  RepoTicketsConfig,
  TicketProviderKind,
  TicketProviderTestResult,
} from '../../lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Section, type SettingsSectionSpec } from './shared'

const defaultLinearConfig = (team = ''): NonNullable<RepoTicketsConfig['linear']> => ({
  mcp: {
    command: 'bunx',
    args: ['mcp-remote@0.1.38', 'https://mcp.linear.app/mcp'],
  },
  tools: {
    list: 'list_issues',
    get: 'get_issue',
    create: 'save_issue',
    update: 'save_issue',
  },
  ...(team ? { team } : {}),
})

function normalizeTicketConfig(
  cfg: RepoTicketsConfig | { error: string } | null,
): RepoTicketsConfig {
  if (!cfg || 'error' in cfg) return { provider: 'local' }
  // Views are provider-independent, so they ride along on every branch — dropping
  // them here would silently wipe the repo's configured views on the next save.
  const views = cfg.views?.length ? { views: cfg.views } : {}
  if (cfg.provider === 'github') return { provider: 'github', github: cfg.github || {}, ...views }
  if (cfg.provider === 'linear')
    return {
      provider: 'linear',
      linear: { ...defaultLinearConfig(), ...(cfg.linear || {}) },
      ...views,
    }
  if (cfg.provider === 'webview')
    return { provider: 'webview', webview: cfg.webview || { url: '' }, ...views }
  return { provider: 'local', ...views }
}

type LinearReadiness = {
  state: 'checking' | 'connected' | 'missing'
  message: string
}

function TicketProviderPanel() {
  const [ctx, setCtx] = useState<TabContext | null>(null)
  const [draft, setDraft] = useState<RepoTicketsConfig>({ provider: 'local' })
  const [saved, setSaved] = useState<RepoTicketsConfig>({ provider: 'local' })
  const [teams, setTeams] = useState<{ id: string; name: string; key?: string }[]>([])
  const [busy, setBusy] = useState<'load' | 'save' | 'test' | 'smoke' | 'teams' | null>('load')
  const [result, setResult] = useState<TicketProviderTestResult | null>(null)
  const [linearReadiness, setLinearReadiness] = useState<LinearReadiness | null>(null)
  const [error, setError] = useState('')

  const inspectLinearTeams = async (cfg: RepoTicketsConfig) => {
    setLinearReadiness({ state: 'checking', message: 'Checking Linear MCP…' })
    try {
      const list = await window.gt.tickets.linearTeams(cfg)
      setTeams(list)
      const team = cfg.linear?.team
      const teamKey = cfg.linear?.teamKey
      const teamLabel = team && teamKey ? `${team} (${teamKey})` : team || teamKey
      setLinearReadiness({
        state: 'connected',
        message: teamLabel
          ? `MCP connected · bound to ${teamLabel}.`
          : list.length
            ? 'MCP connected · choose the team this repo should use.'
            : 'MCP connected, but no Linear teams were returned.',
      })
      return list
    } catch (e) {
      setTeams([])
      setLinearReadiness({ state: 'missing', message: 'Linear MCP is not connected.' })
      throw e
    }
  }

  const load = async () => {
    setBusy('load')
    setError('')
    try {
      const [nextCtx, cfg] = await Promise.all([
        window.gt.tabContext(),
        window.gt.tickets.providerGet(),
      ])
      setCtx(nextCtx)
      const normalized = normalizeTicketConfig(cfg)
      setDraft(normalized)
      setSaved(normalized)
      if (normalized.provider === 'linear') {
        await inspectLinearTeams(normalized).catch(() => {})
      } else {
        setLinearReadiness(null)
      }
    } catch (e) {
      setError((e as Error).message || 'Could not load ticket provider.')
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const provider = draft.provider || 'local'
  const setProvider = (next: TicketProviderKind) => {
    setResult(null)
    setLinearReadiness(null)
    if (next === 'linear')
      setDraft({
        provider: next,
        linear: { ...defaultLinearConfig(draft.linear?.team || draft.linear?.teamKey || '') },
      })
    else if (next === 'github') setDraft({ provider: next, github: draft.github || {} })
    else if (next === 'webview') setDraft({ provider: next, webview: draft.webview || { url: '' } })
    else setDraft({ provider: 'local' })
  }
  const loadTeams = async () => {
    setBusy('teams')
    setError('')
    try {
      const list = await inspectLinearTeams(draft)
      setResult({
        ok: list.length > 0,
        provider: 'linear',
        message: list.length
          ? `Found ${list.length} Linear team${list.length === 1 ? '' : 's'}.`
          : 'No Linear teams returned.',
        teams: list,
      })
    } catch (e) {
      setError((e as Error).message || 'Could not list Linear teams.')
    } finally {
      setBusy(null)
    }
  }
  const saveProvider = async () => {
    setBusy('save')
    setError('')
    try {
      const res = await window.gt.tickets.providerSave(draft)
      if ('error' in res) setError(res.error)
      else {
        const normalized = normalizeTicketConfig(res)
        setSaved(normalized)
        setDraft(normalized)
        window.dispatchEvent(new Event('gt.ticket-provider.changed'))
        setResult({
          ok: true,
          provider: normalized.provider || 'local',
          message: `Saved ${normalized.provider || 'local'} as this repo's ticket source.`,
        })
      }
    } catch (e) {
      setError((e as Error).message || 'Could not save ticket provider.')
    } finally {
      setBusy(null)
    }
  }
  const runTest = async (smoke = false) => {
    setBusy(smoke ? 'smoke' : 'test')
    setError('')
    try {
      const next = await window.gt.tickets.providerTest(draft, smoke)
      setResult(next)
      if (provider === 'linear') {
        setLinearReadiness({
          state: next.ok ? 'connected' : 'missing',
          message: next.message,
        })
      }
    } catch (e) {
      setError((e as Error).message || 'Ticket provider test failed.')
    } finally {
      setBusy(null)
    }
  }
  const providerOpt = (kind: TicketProviderKind, title: string, detail: string) => (
    <button
      onClick={() => setProvider(kind)}
      className={`min-h-[70px] rounded-lg border px-3 py-2 text-left transition-colors ${
        provider === kind
          ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/20 text-zinc-100'
          : 'border-[var(--gt-border)] bg-black/20 text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200'
      }`}
    >
      <div className="text-[12px] font-semibold">{title}</div>
      <div className="mt-0.5 text-[10.5px] leading-snug text-zinc-500">{detail}</div>
    </button>
  )

  const providerChanged = JSON.stringify(saved) !== JSON.stringify(draft)
  const repoLabel = ctx?.repoPath || ctx?.repoRoot || 'Current repo'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--gt-border)] bg-black/20 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-zinc-200">{repoLabel}</div>
          <div className="text-[10.5px] text-zinc-600">
            One source of truth per repo. Switching providers changes where tickets are read and
            written; it does not sync old tickets.
          </div>
        </div>
        <span className="rounded-md border border-[var(--gt-border)] bg-black/25 px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
          saved: {saved.provider || 'local'}
        </span>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {providerOpt(
          'local',
          'Local backlog',
          '.TerMinal/backlog markdown files. Default for every repo.',
        )}
        {providerOpt(
          'github',
          'GitHub Issues',
          'Uses the gh CLI. Best when GitHub issues are the repo tracker.',
        )}
        {providerOpt(
          'linear',
          'Linear',
          'Org source of truth — read and write your team’s Linear issues via MCP.',
        )}
        {providerOpt(
          'webview',
          'Webview',
          'Any URL — a team board that doesn’t map to our schema. No CRUD, just the page.',
        )}
      </div>

      {provider === 'github' && (
        <div className="rounded-lg border border-[var(--gt-border)] bg-black/20 p-3 text-[11px] text-zinc-500">
          TerMinal will check <span className="font-mono text-zinc-300">gh auth status</span> and
          issue availability for this repo. Priority/status are represented as managed labels.
        </div>
      )}

      {provider === 'linear' && (
        <div className="space-y-2 rounded-lg border border-[var(--gt-border)] bg-black/20 p-3">
          <div className="text-[10.5px] leading-snug text-zinc-500">
            Keep your existing Linear workflow: issues stay in Linear, and TerMinal works with the
            same team backlog instead of creating a separate local process.
          </div>
          <div
            className={`rounded-md border px-2.5 py-2 text-[10.5px] leading-snug ${
              linearReadiness?.state === 'connected'
                ? 'border-[var(--gt-green)]/40 bg-[var(--gt-green)]/10 text-[var(--gt-green)]'
                : linearReadiness?.state === 'checking'
                  ? 'border-[var(--gt-border)] bg-black/20 text-zinc-400'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
            }`}
          >
            <div className="flex items-center gap-1.5 font-semibold">
              {linearReadiness?.state === 'checking' ? (
                <Loader2 size={12} className="animate-spin" />
              ) : linearReadiness?.state === 'connected' ? (
                <CircleCheck size={12} />
              ) : (
                <CircleAlert size={12} />
              )}
              {linearReadiness?.message || 'Linear MCP readiness has not been checked.'}
            </div>
            {(!linearReadiness || linearReadiness.state === 'missing') && (
              <div className="mt-1 text-zinc-500">
                Verify Advanced MCP command targets{' '}
                <span className="font-mono text-zinc-400">https://mcp.linear.app/mcp</span>, then
                click Teams and complete Linear sign-in if prompted.
              </div>
            )}
          </div>
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                Team
              </span>
              <select
                value={draft.linear?.team || draft.linear?.teamKey || ''}
                onChange={(e) => {
                  const selected = teams.find(
                    (team) => (team.name || team.key || team.id) === e.target.value,
                  )
                  setDraft({
                    provider: 'linear',
                    linear: {
                      ...defaultLinearConfig(),
                      ...(draft.linear || {}),
                      team: selected?.name || e.target.value,
                      teamKey: selected?.key,
                    },
                  })
                }}
                className="h-[33px] w-full rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[12px] text-zinc-200 outline-none"
              >
                <option value="" className="bg-[var(--gt-panel)]">
                  Pick a team…
                </option>
                {teams.map((team) => (
                  <option
                    key={team.id || team.name}
                    value={team.name || team.key || team.id}
                    className="bg-[var(--gt-panel)]"
                  >
                    {team.name || team.key || team.id}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={loadTeams}
              disabled={busy === 'teams'}
              aria-busy={busy === 'teams' || undefined}
            >
              {busy === 'teams' ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RotateCcw strokeWidth={2} />
              )}
              Teams
            </Button>
          </div>
          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
              Workspace URL
            </span>
            <Input
              value={draft.linear?.workspace || ''}
              onChange={(e) =>
                setDraft({
                  provider: 'linear',
                  linear: {
                    ...defaultLinearConfig(),
                    ...(draft.linear || {}),
                    workspace: e.target.value,
                  },
                })
              }
              placeholder="https://linear.app/your-workspace — start page for the embedded Linear view"
              spellCheck={false}
              className="font-mono"
            />
          </label>
          <details>
            <summary className="cursor-pointer text-[10.5px] text-zinc-600 hover:text-zinc-400">
              Advanced MCP command
            </summary>
            <div className="mt-2 grid gap-2 md:grid-cols-[0.8fr_1.2fr]">
              <Input
                value={draft.linear?.mcp?.command || 'bunx'}
                onChange={(e) =>
                  setDraft({
                    provider: 'linear',
                    linear: {
                      ...defaultLinearConfig(),
                      ...(draft.linear || {}),
                      mcp: { ...(draft.linear?.mcp || {}), command: e.target.value },
                    },
                  })
                }
                className="font-mono"
                spellCheck={false}
              />
              <Input
                value={(
                  draft.linear?.mcp?.args || ['mcp-remote@0.1.38', 'https://mcp.linear.app/mcp']
                ).join(' ')}
                onChange={(e) =>
                  setDraft({
                    provider: 'linear',
                    linear: {
                      ...defaultLinearConfig(),
                      ...(draft.linear || {}),
                      mcp: {
                        ...(draft.linear?.mcp || {}),
                        args: e.target.value.split(/\s+/).filter(Boolean),
                      },
                    },
                  })
                }
                className="font-mono"
                spellCheck={false}
              />
            </div>
          </details>
        </div>
      )}

      {provider === 'webview' && (
        <div className="space-y-2 rounded-lg border border-[var(--gt-border)] bg-black/20 p-3">
          <div className="grid gap-2 md:grid-cols-[0.5fr_1.5fr]">
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                Label
              </span>
              <Input
                value={draft.webview?.label ?? ''}
                onChange={(e) =>
                  setDraft({
                    provider: 'webview',
                    webview: { ...(draft.webview || { url: '' }), label: e.target.value },
                  })
                }
                placeholder="Tickets"
                spellCheck={false}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                URL
              </span>
              <Input
                value={draft.webview?.url ?? ''}
                onChange={(e) =>
                  setDraft({
                    provider: 'webview',
                    webview: { ...(draft.webview || { url: '' }), url: e.target.value },
                  })
                }
                placeholder="https://linear.app/your-team/team/ENG/active"
                className="font-mono"
                spellCheck={false}
              />
            </label>
          </div>
          <div className="text-[10.5px] leading-snug text-zinc-500">
            No schema requirements — this repo has no local backlog. Tickets are read and written
            entirely through this page (and, in an agent session, through that platform&apos;s own
            MCP), not through TerMinal&apos;s ticket tools.
          </div>
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-[var(--gt-border)] bg-black/20 p-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-zinc-200">Ticket views</div>
            <div className="text-[10.5px] leading-snug text-zinc-500">
              Read-only web views shown as sub-tabs in the Tickets tab — a team&apos;s Linear/Jira
              board embedded as-is, no format requirements. Independent of the provider above:
              nothing here changes where tickets are read or written. Update those platforms through
              their own MCP.
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              setDraft({ ...draft, views: [...(draft.views || []), { label: '', url: '' }] })
            }
          >
            <Plus strokeWidth={2} />
            Add
          </Button>
        </div>
        {(draft.views || []).map((v, i) => (
          <div key={i} className="grid gap-2 md:grid-cols-[0.5fr_1.5fr_auto]">
            <Input
              value={v.label}
              onChange={(e) => {
                const views = [...(draft.views || [])]
                views[i] = { ...views[i], label: e.target.value }
                setDraft({ ...draft, views })
              }}
              placeholder="Linear"
              spellCheck={false}
            />
            <Input
              value={v.url}
              onChange={(e) => {
                const views = [...(draft.views || [])]
                views[i] = { ...views[i], url: e.target.value }
                setDraft({ ...draft, views })
              }}
              placeholder="https://linear.app/acme/team/ENG/active"
              className="font-mono"
              spellCheck={false}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() =>
                setDraft({ ...draft, views: (draft.views || []).filter((_, j) => j !== i) })
              }
              title="Remove this view"
              aria-label="Remove this view"
              className="text-zinc-500 hover:text-[var(--gt-red)]"
            >
              <Trash2 strokeWidth={2} />
            </Button>
          </div>
        ))}
        {!(draft.views || []).length && (
          <div className="text-[10.5px] text-zinc-600">
            No views. Add one to embed a board — any https URL works.
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={saveProvider}
          disabled={busy === 'save'}
          aria-busy={busy === 'save' || undefined}
        >
          {busy === 'save' ? <Loader2 className="animate-spin" /> : <CircleCheck strokeWidth={2} />}
          Save
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => runTest(false)}
          disabled={busy === 'test' || providerChanged}
          aria-busy={busy === 'test' || undefined}
          title={
            providerChanged
              ? 'Save before testing this provider.'
              : 'Non-mutating connection check.'
          }
        >
          {busy === 'test' ? <Loader2 className="animate-spin" /> : <Activity strokeWidth={2} />}
          Test
        </Button>
        {provider !== 'webview' && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => runTest(true)}
            disabled={busy === 'smoke' || providerChanged}
            aria-busy={busy === 'smoke' || undefined}
            title={
              providerChanged
                ? 'Save before running smoke.'
                : 'Creates, updates, and closes a real smoke ticket.'
            }
          >
            {busy === 'smoke' ? <Loader2 className="animate-spin" /> : <Send strokeWidth={2} />}
            Smoke
          </Button>
        )}
        {providerChanged && (
          <span className="text-[10.5px] text-amber-300">Save changes before testing.</span>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-[var(--gt-red)]/40 bg-[var(--gt-red)]/10 px-2.5 py-1.5 text-[11px] text-[var(--gt-red)]">
          {error}
        </div>
      )}
      {result && (
        <div
          className={`rounded-md border px-2.5 py-1.5 text-[11px] ${result.ok ? 'border-[var(--gt-green)]/40 bg-[var(--gt-green)]/10 text-[var(--gt-green)]' : 'border-amber-500/40 bg-amber-500/10 text-amber-300'}`}
        >
          {result.message}
          {typeof result.count === 'number' && (
            <span className="ml-1 text-zinc-500">({result.count} tickets)</span>
          )}
          {result.smoke?.key && (
            <Button
              type="button"
              variant="link"
              className="ml-2 h-auto p-0 text-[11px] underline underline-offset-2"
              onClick={() => result.smoke?.url && window.gt.openExternal(result.smoke.url)}
            >
              {result.smoke.key}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function Component() {
  return (
    <Section
      id="tickets"
      icon={TicketIcon}
      title="Tickets"
      desc="Pick the repo's ticket source of truth. Local backlog is the default; GitHub and Linear use their existing CLIs/MCPs."
    >
      <TicketProviderPanel />
    </Section>
  )
}

const section: SettingsSectionSpec = {
  id: 'tickets',
  title: 'Tickets',
  icon: TicketIcon,
  order: 6,
  Component,
}
export default section
