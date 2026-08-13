import { useEffect, useState } from 'react'
import {
  Activity,
  CircleCheck,
  FolderOpen,
  Loader2,
  Plus,
  RotateCcw,
  Send,
  Ticket as TicketIcon,
  Trash2,
} from 'lucide-react'
import type {
  TabContext,
  TicketProviderConfig,
  TicketProviderKind,
  TicketProviderTestResult,
} from '../../lib/types'
import { Section, inp, type SettingsCtx, type SettingsSectionSpec } from './shared'

const defaultLinearConfig = (team = ''): NonNullable<TicketProviderConfig['linear']> => ({
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
  cfg: TicketProviderConfig | { error: string } | null,
): TicketProviderConfig {
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
  if (cfg.provider === 'obsidian')
    return { provider: 'obsidian', obsidian: cfg.obsidian || { vaultPath: '' }, ...views }
  if (cfg.provider === 'webview')
    return { provider: 'webview', webview: cfg.webview || { url: '' }, ...views }
  return { provider: 'local', ...views }
}

function TicketProviderPanel() {
  const [ctx, setCtx] = useState<TabContext | null>(null)
  const [draft, setDraft] = useState<TicketProviderConfig>({ provider: 'local' })
  const [saved, setSaved] = useState<TicketProviderConfig>({ provider: 'local' })
  const [teams, setTeams] = useState<{ id: string; name: string; key?: string }[]>([])
  const [busy, setBusy] = useState<'load' | 'save' | 'test' | 'smoke' | 'teams' | null>('load')
  const [result, setResult] = useState<TicketProviderTestResult | null>(null)
  const [error, setError] = useState('')

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
        const list = await window.gt.tickets.linearTeams(normalized).catch(() => [])
        setTeams(list)
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
    if (next === 'linear')
      setDraft({
        provider: next,
        linear: { ...defaultLinearConfig(draft.linear?.team || draft.linear?.teamKey || '') },
      })
    else if (next === 'github') setDraft({ provider: next, github: draft.github || {} })
    else if (next === 'obsidian')
      setDraft({ provider: next, obsidian: draft.obsidian || { vaultPath: '' } })
    else if (next === 'webview') setDraft({ provider: next, webview: draft.webview || { url: '' } })
    else setDraft({ provider: 'local' })
  }
  const pickVault = async () => {
    const dir = await window.gt.pickDir()
    if (!dir) return
    const name = dir.replace(/\/+$/, '').split('/').pop() || ''
    setResult(null)
    setDraft({
      provider: 'obsidian',
      obsidian: {
        ...(draft.obsidian || { vaultPath: '' }),
        vaultPath: dir,
        ...(draft.obsidian?.vaultName ? {} : { vaultName: name }),
      },
    })
  }
  const loadTeams = async () => {
    setBusy('teams')
    setError('')
    try {
      const list = await window.gt.tickets.linearTeams(draft)
      setTeams(list)
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
      setResult(await window.gt.tickets.providerTest(draft, smoke))
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

  const action =
    'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[var(--gt-border)] bg-black/25 px-3 text-[12px] text-zinc-200 transition-colors hover:border-[var(--gt-accent)]/60 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50'
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
          'Uses Linear MCP. Pick a team and file issues directly in Linear.',
        )}
        {providerOpt(
          'obsidian',
          'Obsidian',
          'Private local vault. Tickets are markdown in a vault folder, never in git.',
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
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                Team
              </span>
              <select
                value={draft.linear?.team || draft.linear?.teamKey || ''}
                onChange={(e) =>
                  setDraft({
                    provider: 'linear',
                    linear: {
                      ...defaultLinearConfig(),
                      ...(draft.linear || {}),
                      team: e.target.value,
                    },
                  })
                }
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
            <button onClick={loadTeams} disabled={busy === 'teams'} className={action}>
              {busy === 'teams' ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <RotateCcw size={13} strokeWidth={2} />
              )}
              Teams
            </button>
          </div>
          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
              Workspace URL
            </span>
            <input
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
              className="h-[33px] w-full rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 font-mono text-[12px] text-zinc-200 outline-none"
            />
          </label>
          <details>
            <summary className="cursor-pointer text-[10.5px] text-zinc-600 hover:text-zinc-400">
              Advanced MCP command
            </summary>
            <div className="mt-2 grid gap-2 md:grid-cols-[0.8fr_1.2fr]">
              <input
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
                className={`${inp} font-mono`}
                spellCheck={false}
              />
              <input
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
                className={`${inp} font-mono`}
                spellCheck={false}
              />
            </div>
          </details>
        </div>
      )}

      {provider === 'obsidian' && (
        <div className="space-y-2 rounded-lg border border-[var(--gt-border)] bg-black/20 p-3">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                Vault folder
              </span>
              <input
                value={draft.obsidian?.vaultPath || ''}
                onChange={(e) =>
                  setDraft({
                    provider: 'obsidian',
                    obsidian: {
                      ...(draft.obsidian || { vaultPath: '' }),
                      vaultPath: e.target.value,
                    },
                  })
                }
                placeholder="/Users/you/Obsidian/MyRepoVault"
                className={`${inp} font-mono`}
                spellCheck={false}
              />
            </label>
            <button onClick={pickVault} className={`${action} self-end`}>
              <FolderOpen size={13} strokeWidth={2} />
              Choose…
            </button>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                Tickets subfolder
              </span>
              <input
                value={draft.obsidian?.ticketsSubdir ?? ''}
                onChange={(e) =>
                  setDraft({
                    provider: 'obsidian',
                    obsidian: {
                      ...(draft.obsidian || { vaultPath: '' }),
                      ticketsSubdir: e.target.value,
                    },
                  })
                }
                placeholder="tickets"
                className={`${inp} font-mono`}
                spellCheck={false}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                Vault name (for links)
              </span>
              <input
                value={draft.obsidian?.vaultName ?? ''}
                onChange={(e) =>
                  setDraft({
                    provider: 'obsidian',
                    obsidian: {
                      ...(draft.obsidian || { vaultPath: '' }),
                      vaultName: e.target.value,
                    },
                  })
                }
                placeholder="MyRepoVault"
                className={`${inp} font-mono`}
                spellCheck={false}
              />
            </label>
          </div>
          <div className="text-[10.5px] leading-snug text-zinc-500">
            Each repo gets its own vault. Tickets are{' '}
            <span className="font-mono text-zinc-300">NNNN-slug.md</span> in{' '}
            <span className="font-mono text-zinc-300">
              {draft.obsidian?.ticketsSubdir?.trim() || 'tickets'}/
            </span>{' '}
            — private and outside git. Keep the vault outside any repo so nothing leaks.
          </div>
        </div>
      )}

      {provider === 'webview' && (
        <div className="space-y-2 rounded-lg border border-[var(--gt-border)] bg-black/20 p-3">
          <div className="grid gap-2 md:grid-cols-[0.5fr_1.5fr]">
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                Label
              </span>
              <input
                value={draft.webview?.label ?? ''}
                onChange={(e) =>
                  setDraft({
                    provider: 'webview',
                    webview: { ...(draft.webview || { url: '' }), label: e.target.value },
                  })
                }
                placeholder="Tickets"
                className={inp}
                spellCheck={false}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                URL
              </span>
              <input
                value={draft.webview?.url ?? ''}
                onChange={(e) =>
                  setDraft({
                    provider: 'webview',
                    webview: { ...(draft.webview || { url: '' }), url: e.target.value },
                  })
                }
                placeholder="https://linear.app/your-team/team/ENG/active"
                className={`${inp} font-mono`}
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
          <button
            onClick={() =>
              setDraft({ ...draft, views: [...(draft.views || []), { label: '', url: '' }] })
            }
            className={action}
          >
            <Plus size={13} strokeWidth={2} />
            Add
          </button>
        </div>
        {(draft.views || []).map((v, i) => (
          <div key={i} className="grid gap-2 md:grid-cols-[0.5fr_1.5fr_auto]">
            <input
              value={v.label}
              onChange={(e) => {
                const views = [...(draft.views || [])]
                views[i] = { ...views[i], label: e.target.value }
                setDraft({ ...draft, views })
              }}
              placeholder="Linear"
              className={inp}
              spellCheck={false}
            />
            <input
              value={v.url}
              onChange={(e) => {
                const views = [...(draft.views || [])]
                views[i] = { ...views[i], url: e.target.value }
                setDraft({ ...draft, views })
              }}
              placeholder="https://linear.app/acme/team/ENG/active"
              className={`${inp} font-mono`}
              spellCheck={false}
            />
            <button
              onClick={() =>
                setDraft({ ...draft, views: (draft.views || []).filter((_, j) => j !== i) })
              }
              className={action}
              title="Remove this view"
            >
              <Trash2 size={13} strokeWidth={2} />
            </button>
          </div>
        ))}
        {!(draft.views || []).length && (
          <div className="text-[10.5px] text-zinc-600">
            No views. Add one to embed a board — any https URL works.
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={saveProvider} disabled={busy === 'save'} className={action}>
          {busy === 'save' ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <CircleCheck size={13} strokeWidth={2} />
          )}
          Save
        </button>
        <button
          onClick={() => runTest(false)}
          disabled={busy === 'test' || providerChanged}
          className={action}
          title={
            providerChanged ? 'Save before testing this provider.' : 'Non-mutating connection check.'
          }
        >
          {busy === 'test' ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Activity size={13} strokeWidth={2} />
          )}
          Test
        </button>
        {provider !== 'webview' && (
          <button
            onClick={() => runTest(true)}
            disabled={busy === 'smoke' || providerChanged}
            className={action}
            title={
              providerChanged ? 'Save before running smoke.' : 'Creates, updates, and closes a real smoke ticket.'
            }
          >
            {busy === 'smoke' ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Send size={13} strokeWidth={2} />
            )}
            Smoke
          </button>
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
            <button
              onClick={() => result.smoke?.url && window.gt.openExternal(result.smoke.url)}
              className="ml-2 underline underline-offset-2"
            >
              {result.smoke.key}
            </button>
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
