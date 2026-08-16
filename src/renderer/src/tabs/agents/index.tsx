import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot } from 'lucide-react'
import { Badge } from '../../components/ui/badge'
import { EnginePicker } from '../../components/EnginePicker'
import { useResizableWidth, ResizeHandle } from '../../components/ResizeHandle'
import { onNavigate } from '../../lib/nav'
import { useLangsReady } from '../../lib/lazyLang'
import { openPromptInTerminal, remoteForTabContext } from '../../lib/launch'
import { agentPrompt } from '../../lib/agentPrompts'
import { lastRunByAgent as rollupLastRun, type UnifiedRunRow } from '../../lib/agentsView'
import type { Tab, TabContext, Agent, AgentDefinition, AgentRun, Engine } from '../../lib/types'
import { AgentList, type AgentMode } from './AgentList'
import {
  ClassicAgentDetail,
  PersistentDefinitionDetail,
  type AgentDetailState,
  type DetailTabKey,
} from './AgentDetail'
import { AgentDesigner } from './AgentDesigner'
import { AgentEditor } from './AgentEditor'
import { PersistentAgentsPanel } from './PersistentPanel'

// The Agents tab: roster on the left, selected agent on the right, three
// modals on top. This module owns the state, the IPC subscriptions, and the
// layout; the rail lives in AgentList, the pane in AgentDetail, the memory
// workspace in PersistentPanel, and every shaping helper in lib/agentsView.

function AgentsTab({ ctx }: { ctx: TabContext }) {
  // Pulls the (code-split) CodeMirror grammars in on first mount of a tab
  // that can host an editor, and re-renders once they land. See lazyLang.ts.
  useLangsReady()
  const railW = useResizableWidth('gt.agentsRailWidth', 320, { min: 240, max: 560, edge: 'right' })
  const [agentMode, setAgentMode] = useState<AgentMode>(() => {
    const saved = localStorage.getItem('gt.agents.mode')
    return saved === 'classic' || saved === 'persistent' || saved === 'all' ? saved : 'all'
  })
  const [definitions, setDefinitions] = useState<AgentDefinition[] | null>(null)
  const [selDefinitionId, setSelDefinitionId] = useState<string | null>(
    () => localStorage.getItem('gt.agents.definitionSel') || null,
  )
  const [agents, setAgents] = useState<Agent[] | null>(null)
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [outputs, setOutputs] = useState<Record<string, string>>({})
  const [sel, setSel] = useState<string | null>(null)
  const [picking, setPicking] = useState<{ id: string; title: string } | null>(null)
  const [editing, setEditing] = useState<Agent | 'new' | null>(null)
  // Persist UI position across reloads so coming back to the tab lands on the
  // same agent/filter/search. Cheap localStorage; the values are tiny strings.
  const [agentFilter, setAgentFilter] = useState<'all' | 'generic' | 'per-repo'>(
    () => (localStorage.getItem('gt.agents.filter') as 'all' | 'generic' | 'per-repo') || 'all',
  )
  const [agentSearch, setAgentSearch] = useState<string>(
    () => localStorage.getItem('gt.agents.search') || '',
  )
  const [selAgentId, setSelAgentId] = useState<string | null>(
    () => localStorage.getItem('gt.agents.sel') || null,
  )
  // Detail view is split into horizontal tabs (contract first). Reset to the
  // default tab whenever the selected agent changes.
  const [detailTab, setDetailTab] = useState<DetailTabKey>('overview')
  useEffect(() => setDetailTab('overview'), [selAgentId])
  useEffect(() => {
    localStorage.setItem('gt.agents.filter', agentFilter)
  }, [agentFilter])
  useEffect(() => {
    localStorage.setItem('gt.agents.mode', agentMode)
  }, [agentMode])
  useEffect(() => {
    if (selDefinitionId) localStorage.setItem('gt.agents.definitionSel', selDefinitionId)
    else localStorage.removeItem('gt.agents.definitionSel')
  }, [selDefinitionId])
  useEffect(() => {
    localStorage.setItem('gt.agents.search', agentSearch)
  }, [agentSearch])
  useEffect(() => {
    if (selAgentId) localStorage.setItem('gt.agents.sel', selAgentId)
    else localStorage.removeItem('gt.agents.sel')
  }, [selAgentId])
  const [designerOpen, setDesignerOpen] = useState(false)
  const [scripts, setScripts] = useState<Record<string, { path: string; body: string } | null>>({})
  const logRef = useRef<HTMLDivElement>(null)

  const reloadDefinitions = () =>
    window.gt.agents.definitions().then((defs) => {
      setDefinitions(defs)
      setSelDefinitionId((prev) =>
        prev && defs.some((d) => d.id === prev) ? prev : defs[0]?.id || null,
      )
    })
  const reloadAgents = () => {
    window.gt.agents.list().then(setAgents)
    reloadDefinitions()
  }
  // Lazy-load the bash script body the first time we need it; cache the
  // result (including null when definitively no script exists) so we don't
  // re-hit IPC. Triggered on agent select (new master-detail layout) and on
  // expand toggle (legacy paths).
  const loadScript = (id: string) => {
    if (id in scripts) return
    window.gt.agents.script(id).then((r) => setScripts((m) => ({ ...m, [id]: r })))
  }
  // Auto-load script when an agent is selected so the right pane's Script
  // section can show "Loading…" → bash / prompt without a manual click.
  useEffect(() => {
    if (selAgentId) loadScript(selAgentId)
  }, [selAgentId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cross-source last-run status per agent. We already have in-process runs
  // in `runs`; for cron runs, fetch via the unified endpoint so the left rail
  // also covers schedule-fired runs. Refresh on activity:event so a freshly
  // finished cron run updates the status dot immediately.
  const [allRuns, setAllRuns] = useState<UnifiedRunRow[]>([])
  // Per-agent week-spend from the AI ledger (#0001). Joined into the
  // Recent-runs header so the operator sees "Sonnet eats $4 this week"
  // without flipping to the Spend tab.
  const [agentSpendWeek, setAgentSpendWeek] = useState<
    Record<string, { runs: number; usd: number }>
  >({})
  useEffect(() => {
    const load = () =>
      window.gt.observability.byAgent('week').then((rows) => {
        const m: Record<string, { runs: number; usd: number }> = {}
        for (const r of rows) m[r.agentId] = { runs: r.runs, usd: r.usd }
        setAgentSpendWeek(m)
      })
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    const load = () => window.gt.agents.allRuns().then(setAllRuns)
    load()
    const off = window.gt.activity.onEvent(load)
    const t = setInterval(load, 30_000)
    return () => {
      off()
      clearInterval(t)
    }
  }, [])
  const lastRunByAgent = useMemo(() => rollupLastRun(allRuns), [allRuns])

  // Per-(repo, agent) state sidecar. Surfaced in the right pane so the
  // operator can see "last scanned X ago" without `cat`-ing the JSON.
  // Re-fetched on select + after a successful run completes (the agent
  // would normally call `terminal-cli state mark-main` at exit).
  const [state, setState] = useState<AgentDetailState>(null)
  const reloadState = (id: string | null) => {
    if (!id) return setState(null)
    window.gt.agents.state(id).then(setState)
  }
  useEffect(() => {
    reloadState(selAgentId)
  }, [selAgentId])
  // Bump the state view when ANY run for the selected agent finishes — the
  // run almost certainly wrote a new lastScannedSha/lastRunAt.
  //
  // onStatus only fires for IN-PROCESS runs (Run button on this tab, on
  // Tickets, on PRs). Cron runs fire from launchd; their completion never
  // reaches the renderer that way. We ALSO listen on activity:event because
  // every cron run's `check`/`run-failed` activity emit lands here regardless
  // of who started it. The state IPC is one file read — re-running it on
  // every activity tick is dirt-cheap.
  useEffect(() => {
    const offStatus = window.gt.agents.onStatus((run) => {
      const r = run as { agentId?: string; status?: string }
      if (r.agentId === selAgentId && (r.status === 'done' || r.status === 'failed')) {
        reloadState(selAgentId)
      }
    })
    const offAct = window.gt.activity.onEvent(() => {
      if (selAgentId) reloadState(selAgentId)
    })
    return () => {
      offStatus()
      offAct()
    }
  }, [selAgentId])
  useEffect(() => {
    reloadAgents()
    window.gt.agents.runs().then((rs) => {
      setRuns(rs)
      setOutputs((o) => {
        const next = { ...o }
        for (const r of rs) if (next[r.id] === undefined) next[r.id] = r.output
        return next
      })
      if (rs[0]) setSel((s) => s ?? rs[0].id)
    })
    const offStatus = window.gt.agents.onStatus((run) => {
      setRuns((prev) => {
        const i = prev.findIndex((r) => r.id === run.id)
        if (i < 0) return [run, ...prev]
        const next = [...prev]
        next[i] = run
        return next
      })
      setOutputs((o) => (o[run.id] === undefined ? { ...o, [run.id]: run.output } : o))
      setSel((s) => s ?? run.id)
      // When a designer run finishes, reload the agents list so the newly-
      // saved entry shows up without a manual refresh — then auto-expand
      // the new agent and load its script so the bash body is immediately
      // visible (closes the loop on the "describe it → see the script" flow).
      if (
        (run.agentId === 'design-repo' || run.agentId === 'design-global') &&
        run.status === 'done'
      ) {
        const priorIds = new Set((agents || []).map((a) => a.id))
        window.gt.agents.list().then((next) => {
          setAgents(next)
          reloadDefinitions()
          const fresh = next.find((a) => !priorIds.has(a.id))
          if (!fresh) return
          setAgentMode('all')
          setSelAgentId(fresh.id)
          setSelDefinitionId(
            `classic:${fresh.source === 'global' || fresh.source === 'global-override' ? 'global' : 'repo'}:${fresh.id}`,
          )
          window.gt.agents
            .script(fresh.id)
            .then((r) => setScripts((m) => ({ ...m, [fresh.id]: r })))
        })
      }
    })
    const offOutput = window.gt.agents.onOutput(({ runId, chunk }) => {
      setOutputs((o) => ({ ...o, [runId]: (o[runId] || '') + chunk }))
    })
    return () => {
      offStatus()
      offOutput()
    }
  }, [ctx.sessionId])

  const selectedRun = runs.find((r) => r.id === sel) || null
  const runningByAgent = useMemo(
    () => new Set(runs.filter((r) => r.status === 'running').map((r) => r.agentId)),
    [runs],
  )
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [sel, selectedRun && outputs[selectedRun.id]])
  const selectedDefinition = useMemo(
    () => (definitions || []).find((d) => d.id === selDefinitionId) || null,
    [definitions, selDefinitionId],
  )
  useEffect(() => {
    if (
      agentMode === 'all' &&
      selectedDefinition?.kind === 'classic' &&
      selectedDefinition.ref.id !== selAgentId
    ) {
      setSelAgentId(selectedDefinition.ref.id)
    }
  }, [agentMode, selectedDefinition, selAgentId])

  // Cross-tab nav: navigateTo('agents', { definitionId, agentId, kind }) opens
  // straight to that agent — e.g. "View in Agents tab" on a ticket's Owner tab.
  // Selection is by definition id (`${kind}:${scope}:${id}`), so a repo-local
  // and a global agent sharing an id never resolve to each other.
  useEffect(
    () =>
      onNavigate((ev) => {
        if (ev.tabId !== 'agents') return
        const definitionId = ev.payload?.definitionId as string | undefined
        const agentId = ev.payload?.agentId as string | undefined
        if (!definitionId || !agentId) return
        setAgentMode('all')
        setSelDefinitionId(definitionId)
        if (ev.payload?.kind === 'classic') setSelAgentId(agentId)
        else localStorage.setItem('gt.persistentAgents.sel', agentId)
      }),
    [],
  )

  const run = async (
    id: string,
    engine: Engine,
    persona: string,
    pipeline: string,
    model?: string,
    openrouterHarness?: 'codex' | 'hermes',
    extraContext?: string,
  ) => {
    const r = await window.gt.agents.run(
      id,
      engine,
      persona,
      pipeline,
      model,
      remoteForTabContext(ctx),
      openrouterHarness,
      extraContext,
    )
    if ('error' in r) {
      setOutputs((o) => ({ ...o, __err: r.error }))
      return
    }
    setRuns((prev) => [r, ...prev.filter((x) => x.id !== r.id)])
    setSel(r.id)
  }

  const activeRunCount = runs.filter((r) => r.status === 'running').length

  // Mode switch lives at the top of the rail (each layout has one) rather than a
  // dedicated header bar — the tab chrome already names the tab.
  const modeToggle = (
    <div className="flex items-center gap-1.5">
      <div className="flex flex-1 items-center rounded-md border border-[var(--gt-border)] bg-black/20 p-0.5">
        {(['all', 'classic', 'persistent'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setAgentMode(mode)}
            className={`flex-1 rounded-sm px-2 py-1 text-[11px] font-medium capitalize ${
              agentMode === mode
                ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {mode}
          </button>
        ))}
      </div>
      {activeRunCount > 0 && <Badge variant="success">{activeRunCount}</Badge>}
    </div>
  )

  if (agentMode === 'persistent') {
    return (
      <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
        <PersistentAgentsPanel ctx={ctx} headerSlot={modeToggle} />
      </div>
    )
  }

  // The right pane resolves to one of three things: the empty prompt, a
  // persistent agent's read-only profile, or a classic agent's full detail.
  const selectedAgent =
    (agents || []).find(
      (a) => a.id === (agentMode === 'all' ? selectedDefinition?.ref.id : selAgentId),
    ) || null
  const activeDefinition =
    selectedAgent &&
    (selectedDefinition?.kind === 'classic' && selectedDefinition.ref.id === selectedAgent.id
      ? selectedDefinition
      : (definitions || []).find((d) => d.kind === 'classic' && d.ref.id === selectedAgent.id) ||
        null)
  const emptyPane = (
    <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">
      Pick an agent on the left, or click{' '}
      <span className="mx-1 font-semibold text-zinc-400">New</span> to design one.
    </div>
  )

  const detailPane = () => {
    if (agentMode === 'all' && !selectedDefinition) return emptyPane
    if (agentMode === 'all' && selectedDefinition?.kind === 'persistent') {
      return (
        <PersistentDefinitionDetail
          definition={selectedDefinition}
          onOpenWorkspace={() => {
            localStorage.setItem('gt.persistentAgents.sel', selectedDefinition.ref.id)
            setAgentMode('persistent')
          }}
        />
      )
    }
    if (!selectedAgent) return emptyPane
    return (
      <ClassicAgentDetail
        agent={selectedAgent}
        definition={activeDefinition || null}
        script={scripts[selectedAgent.id]}
        busy={runningByAgent.has(selectedAgent.id)}
        agentRuns={runs.filter((r) => r.agentId === selectedAgent.id)}
        allRuns={allRuns}
        spendWeek={agentSpendWeek[selectedAgent.id]}
        state={state}
        detailTab={detailTab}
        onDetailTab={setDetailTab}
        sel={sel}
        onSel={setSel}
        selectedRun={selectedRun}
        outputs={outputs}
        logRef={logRef}
        onRun={() => setPicking({ id: selectedAgent.id, title: selectedAgent.title })}
        onEdit={() => setEditing(selectedAgent)}
        onReset={async () => {
          await window.gt.agents.reset(selectedAgent.id)
          reloadAgents()
        }}
        onHide={async () => {
          await window.gt.presets.hide('agents', selectedAgent.id)
          reloadAgents()
        }}
        onStateReset={async () => {
          if (!confirm('Reset state? Next run will scan from cold.')) return
          await window.gt.agents.stateReset(selectedAgent.id)
          reloadState(selectedAgent.id)
        }}
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <div className="flex min-h-0 flex-1">
        {/* ━━ LEFT RAIL: narrow agents list (search + filter + click-to-select) ━━ */}
        <AgentList
          width={railW.width}
          mode={agentMode}
          modeToggle={modeToggle}
          search={agentSearch}
          onSearch={setAgentSearch}
          filter={agentFilter}
          onFilter={setAgentFilter}
          onNew={() => setDesignerOpen(true)}
          definitions={definitions}
          agents={agents}
          selDefinitionId={selDefinitionId}
          selAgentId={selAgentId}
          runningByAgent={runningByAgent}
          lastRunByAgent={lastRunByAgent}
          onSelectDefinition={(d) => {
            setSelDefinitionId(d.id)
            if (d.kind === 'classic') setSelAgentId(d.ref.id)
            if (d.kind === 'persistent') localStorage.setItem('gt.persistentAgents.sel', d.ref.id)
          }}
          onSelectAgent={setSelAgentId}
        />
        <ResizeHandle onMouseDown={railW.onResizeStart} />

        {/* ━━ RIGHT PANE: selected-agent detail (header + script + runs + log) ━━ */}
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden">{detailPane()}</section>
      </div>

      {picking && (
        <EnginePicker
          title={`Run · ${picking.title}`}
          showPersona={false}
          showPipeline={false}
          showExtraContext
          onClose={() => setPicking(null)}
          onPick={(
            e,
            persona,
            pipeline,
            model,
            launchMode,
            _ctx,
            _lanes,
            openrouterHarness,
            extraContext,
          ) => {
            const target = (agents || []).find((a) => a.id === picking.id)
            if (launchMode === 'terminal' && target) {
              const prompt = agentPrompt(target, { persona, pipeline, model })
              openPromptInTerminal({
                engine: e,
                cwd: ctx.repoRoot,
                name: target.title,
                prompt: extraContext
                  ? `${prompt}\n\n--- Additional context for THIS run ---\n${extraContext}`
                  : prompt,
                remote: remoteForTabContext(ctx),
                openrouterHarness,
              })
            } else {
              run(picking.id, e, persona, pipeline, model, openrouterHarness, extraContext)
            }
            setPicking(null)
          }}
        />
      )}

      {designerOpen && (
        <AgentDesigner
          repoRoot={ctx.repoRoot}
          remote={remoteForTabContext(ctx)}
          onClose={() => setDesignerOpen(false)}
          onSpawned={(r) => {
            setDesignerOpen(false)
            setRuns((prev) => [r, ...prev.filter((x) => x.id !== r.id)])
            setSel(r.id)
          }}
          onAdvanced={() => {
            setDesignerOpen(false)
            setEditing('new')
          }}
        />
      )}

      {editing && (
        <AgentEditor
          agent={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reloadAgents()
          }}
        />
      )}
    </div>
  )
}

const tab: Tab = {
  id: 'agents',
  title: 'Agents',
  icon: Bot,
  order: 3,
  appliesTo: (ctx) => ctx.hasAgents,
  badge: async (gt) => (await gt.agents.runs()).filter((r) => r.status === 'running').length,
  Component: AgentsTab,
}
export default tab
