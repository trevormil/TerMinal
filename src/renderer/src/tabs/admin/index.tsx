import { useCallback, useEffect, useState } from 'react'
import { Shield, RefreshCw, ExternalLink, Check, X, Play, Download } from 'lucide-react'
import type { Tab, TabContext, AdminModule, ModulesStatus, AdminModuleAction, AdminDataSource } from '../../lib/types'
import { navigateTo } from '../../lib/nav'
import { Badge, type BadgeTone } from '../../components/ui'

// Sidebar grouping (display order + labels). Modules self-report surface.group.
const GROUPS: { id: string; label: string }[] = [
  { id: 'runtime', label: 'Runtime' },
  { id: 'api-docs', label: 'API & Docs' },
  { id: 'observability', label: 'Observability' },
  { id: 'growth', label: 'Product & Growth' },
  { id: 'infra', label: 'Data & Infra' },
  { id: 'quality', label: 'Quality & Security' },
]

const presenceDot = (state: string) =>
  state === 'present' ? 'var(--gt-green)' : state === 'partial' ? 'var(--gt-yellow)' : '#52525b'
const presenceTone = (state: string): BadgeTone =>
  state === 'present' ? 'green' : state === 'partial' ? 'yellow' : 'mute'

function AdminTab({ ctx }: { ctx: TabContext }) {
  const [data, setData] = useState<ModulesStatus | null>(null)
  const [err, setErr] = useState<string | undefined>()
  const [sel, setSel] = useState<string | undefined>()
  const [profile, setProfile] = useState<string>('')
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [queryOut, setQueryOut] = useState<Record<string, { rows?: unknown[]; text?: string; error?: string }>>({})

  const repoRoot = ctx.repoRoot
  const load = useCallback(() => {
    if (!repoRoot) {
      setData(null)
      return
    }
    window.gt.modules.status(repoRoot).then((r) => {
      if ('error' in r) {
        setErr(r.error)
        setData(null)
        return
      }
      setErr(undefined)
      setData(r)
      setProfile((p) => p || r.profile || 'web-service')
      setSel((s) => s || r.modules.find((m) => m.state !== 'absent')?.id || r.modules[0]?.id)
    })
  }, [repoRoot])
  useEffect(load, [load])

  const modules = data?.modules ?? []
  const selected = modules.find((m) => m.id === sel)
  const presentCount = modules.filter((m) => m.state === 'present').length

  async function withBusy(key: string, fn: () => Promise<void>) {
    setBusy((b) => ({ ...b, [key]: true }))
    try {
      await fn()
    } finally {
      setBusy((b) => ({ ...b, [key]: false }))
      load()
    }
  }
  const openLink = (url: string) => {
    if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url)) navigateTo('browser', { url })
    else window.gt.openExternal(url)
  }
  const runQuery = async (src: AdminDataSource, key: string) => {
    setQueryOut((q) => ({ ...q, [key]: { text: '…' } }))
    const out = await window.gt.modules.query(repoRoot, src)
    setQueryOut((q) => ({ ...q, [key]: out }))
  }
  async function runAction(m: AdminModule, a: AdminModuleAction) {
    await withBusy(`${m.id}:${a.id}`, async () => {
      if (a.kind === 'seed') await window.gt.modules.seed(repoRoot, m.id)
      else if (a.kind === 'apply-profile' && profile) await window.gt.modules.applyProfile(repoRoot, profile)
      else if (a.kind === 'cli' && a.cmd) await runQuery({ kind: 'cli', cmd: a.cmd }, `action:${a.id}`)
      else if (a.kind === 'toggle-schedule' || a.kind === 'run-check') navigateTo('schedules', { repo: ctx.repoPath })
    })
  }

  if (!repoRoot) {
    return <div className="p-6 text-[12px] text-zinc-600">Open a repository to manage its capability modules.</div>
  }

  return (
    <div className="flex h-full min-h-0 bg-[var(--gt-bg)]">
      {/* sidebar */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--gt-border)] bg-[var(--gt-panel)]">
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-3 py-2">
          <Shield size={14} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
          <span className="text-[12px] font-semibold text-zinc-200">Admin</span>
          <span className="text-[11px] text-zinc-600">
            {presentCount}/{modules.length}
          </span>
          <button onClick={load} className="ml-auto text-zinc-600 hover:text-zinc-300" title="Refresh">
            <RefreshCw size={12} strokeWidth={2} />
          </button>
        </div>
        {/* profile selector */}
        <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--gt-border)] p-2">
          <select
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            className="flex-1 rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60"
          >
            {Object.keys(data?.profiles ?? { 'web-service': [] }).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button
            onClick={() =>
              withBusy('apply-profile', async () => {
                await window.gt.modules.applyProfile(repoRoot, profile)
              })
            }
            disabled={busy['apply-profile']}
            className="rounded-md border border-[var(--gt-accent)]/50 bg-[var(--gt-accent)]/10 px-2 py-1 text-[11px] font-semibold text-[var(--gt-accent-light)] hover:bg-[var(--gt-accent)]/20 disabled:opacity-50"
          >
            {busy['apply-profile'] ? 'Applying…' : 'Apply profile'}
          </button>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {err && <div className="px-2 py-3 text-[11px] text-[var(--gt-red)]">{err}</div>}
          {GROUPS.map((g) => {
            const mods = modules.filter((m) => m.surface.group === g.id)
            if (!mods.length) return null
            return (
              <div key={g.id} className="mb-1">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-700">
                  {g.label}
                </div>
                {mods.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setSel(m.id)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] ${
                      sel === m.id ? 'bg-[var(--gt-accent)]/15 text-zinc-100' : 'text-zinc-400 hover:bg-white/5'
                    }`}
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: presenceDot(m.state) }}
                    />
                    <span className="min-w-0 flex-1 truncate">{m.surface.adminLabel}</span>
                    {m.enabled && <span className="text-[9px] uppercase text-[var(--gt-green)]">on</span>}
                  </button>
                ))}
              </div>
            )
          })}
        </nav>
      </aside>

      {/* panel */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        {!selected ? (
          <div className="p-6 text-[12px] text-zinc-600">Select a module.</div>
        ) : (
          <div className="p-5">
            <div className="mb-1 flex items-center gap-2">
              <h1 className="text-lg font-bold text-zinc-100">{selected.title}</h1>
              <Badge tone={presenceTone(selected.state)}>{selected.state}</Badge>
              {selected.scope === 'platform' && <Badge tone="accent">platform</Badge>}
            </div>
            <p className="mb-4 text-[12px] text-zinc-500">{selected.summary}</p>

            {/* detected markers */}
            <div className="mb-4">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Detected</div>
              <div className="flex flex-col gap-0.5">
                {selected.markers.map((mk) => (
                  <div key={mk.path} className="flex items-center gap-1.5 font-mono text-[11px] text-zinc-500">
                    {mk.present ? (
                      <Check size={11} className="text-[var(--gt-green)]" />
                    ) : (
                      <X size={11} className="text-zinc-600" />
                    )}
                    {mk.path}
                  </div>
                ))}
              </div>
            </div>

            {/* links */}
            {selected.surface.links?.length ? (
              <div className="mb-4 flex flex-wrap gap-2">
                {selected.surface.links.map((l) => (
                  <button
                    key={l.url}
                    onClick={() => openLink(l.url)}
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-[var(--gt-accent-2)] hover:border-[var(--gt-accent)]/50"
                  >
                    {l.label}
                    <ExternalLink size={10} strokeWidth={2} />
                  </button>
                ))}
              </div>
            ) : null}

            {/* actions */}
            {selected.surface.actions?.length ? (
              <div className="mb-4 flex flex-wrap gap-2">
                {selected.surface.actions.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => runAction(selected, a)}
                    disabled={busy[`${selected.id}:${a.id}`]}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[var(--gt-border)] bg-[var(--gt-panel)] px-2.5 py-1 text-[11px] font-semibold text-zinc-300 hover:border-[var(--gt-accent)]/50 disabled:opacity-50"
                  >
                    {a.kind === 'seed' ? <Download size={11} /> : a.kind === 'cli' ? <Play size={11} /> : null}
                    {busy[`${selected.id}:${a.id}`] ? '…' : a.label}
                  </button>
                ))}
              </div>
            ) : null}

            {/* monitoring widgets (data adapters) */}
            {selected.surface.data?.length ? (
              <div className="mb-4">
                <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                  Monitoring
                </div>
                {selected.surface.data.map((src, i) => {
                  const key = `data:${i}`
                  const out = queryOut[key]
                  return (
                    <div key={i} className="mb-2 rounded-md border border-[var(--gt-border)] bg-black/20 p-2">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="font-mono text-[10px] text-zinc-600">
                          {src.kind}
                          {src.kind === 'http' ? ` ${src.url}` : src.kind === 'file' ? ` ${src.path}` : src.kind === 'cli' ? ` ${src.cmd.slice(0, 40)}` : ''}
                        </span>
                        <button
                          onClick={() => runQuery(src, key)}
                          className="ml-auto text-zinc-600 hover:text-zinc-300"
                          title="Fetch"
                        >
                          <RefreshCw size={11} />
                        </button>
                      </div>
                      {out ? (
                        out.error ? (
                          <div className="text-[11px] text-[var(--gt-red)]">{out.error}</div>
                        ) : out.rows ? (
                          <pre className="max-h-48 overflow-auto text-[10.5px] text-zinc-400">
                            {JSON.stringify(out.rows.slice(0, 20), null, 1)}
                          </pre>
                        ) : (
                          <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[10.5px] text-zinc-400">
                            {out.text}
                          </pre>
                        )
                      ) : (
                        <div className="text-[10.5px] text-zinc-600">Click ↻ to fetch.</div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : null}

            {/* action cli output */}
            {Object.entries(queryOut)
              .filter(([k]) => k.startsWith('action:'))
              .map(([k, out]) => (
                <pre key={k} className="mb-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--gt-border)] bg-black/20 p-2 text-[10.5px] text-zinc-400">
                  {out.error || out.text || JSON.stringify(out.rows, null, 1)}
                </pre>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}

const tab: Tab = {
  id: 'admin',
  title: 'Admin',
  icon: Shield,
  order: 8.7,
  appliesTo: () => true,
  Component: AdminTab,
}
export default tab
