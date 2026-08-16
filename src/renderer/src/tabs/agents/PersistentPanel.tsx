import { useEffect, useState, type ReactNode } from 'react'
import { Bot, FileText, Play, Trash2, FolderOpen, Plus, ClipboardList } from 'lucide-react'
import { Badge } from '../../components/ui/badge'
import { EnginePicker } from '../../components/EnginePicker'
import { useResizableWidth, ResizeHandle } from '../../components/ResizeHandle'
import { EngineLogo } from '../../components/EngineLogo'
import { CodeEditor } from '../../components/CodeEditor'
import { Markdown } from '../../components/Markdown'
import { navigateTo } from '../../lib/nav'
import { openPromptInTerminal, remoteForTabContext, type LaunchMode } from '../../lib/launch'
import { relativeTime } from '../../lib/time'
import {
  artifactDefaultPath,
  filterPersistentAgents,
  fmtBytes,
  nextArtifactId,
} from '../../lib/agentsView'
import type {
  Engine,
  FileEntry,
  PersistentAgent,
  PersistentAgentDetail,
  PersistentAgentFiles,
  PersistentArtifact,
  PersistentArtifactRead,
  TabContext,
} from '../../lib/types'
import { langForAgentFile } from './agentsShared'
import { PersistentAgentEditor } from './PersistentAgentEditor'

// The persistent-agent memory workspace: a rail of global memory agents and,
// for the selected one, its four memory files, its scoped file tree, and the
// artifacts its runs left behind. Runs happen from the current workspace repo
// while reading/writing the agent's global directory.

const fmtRelative = relativeTime

type PersistentFileKey = keyof PersistentAgentFiles
type PersistentViewKey = PersistentFileKey | 'artifacts' | 'files'

const PROTECTED_FILES = ['agent.json', 'INSTRUCTIONS.md', 'MEMORY.md', 'STATE.md', 'JOURNAL.md']

/** The memory file a non-artifact/non-files view edits. */
const MEMORY_FILE: Record<PersistentFileKey, string> = {
  instructions: 'INSTRUCTIONS.md',
  memory: 'MEMORY.md',
  state: 'STATE.md',
  journal: 'JOURNAL.md',
}

export function PersistentAgentsPanel({
  ctx,
  headerSlot,
}: {
  ctx: TabContext
  headerSlot?: ReactNode
}) {
  const railW = useResizableWidth('gt.agentsRailWidth', 288, { min: 220, max: 520, edge: 'right' })
  const [agents, setAgents] = useState<PersistentAgent[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    localStorage.getItem('gt.persistentAgents.sel'),
  )
  const [detail, setDetail] = useState<PersistentAgentDetail | null>(null)
  const [query, setQuery] = useState('')
  const [task, setTask] = useState('')
  const [pickingRun, setPickingRun] = useState(false)
  const [fileKey, setFileKey] = useState<PersistentViewKey>('instructions')
  const [fileDraft, setFileDraft] = useState('')
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState('')
  const [fileDir, setFileDir] = useState('')
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([])
  const [agentFilePath, setAgentFilePath] = useState('')
  const [agentFileContent, setAgentFileContent] = useState('')
  const [agentFileDirty, setAgentFileDirty] = useState(false)
  const [agentFileErr, setAgentFileErr] = useState('')
  const [artifacts, setArtifacts] = useState<PersistentArtifact[]>([])
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null)
  const [selectedArtifactPath, setSelectedArtifactPath] = useState<string | null>(null)
  const [artifactBody, setArtifactBody] = useState<PersistentArtifactRead | null>(null)

  const loadList = () =>
    window.gt.persistentAgents.list().then((list) => {
      setAgents(list)
      setSelectedId((prev) => prev || list[0]?.id || null)
    })
  useEffect(() => {
    loadList()
  }, [])
  useEffect(() => {
    if (selectedId) localStorage.setItem('gt.persistentAgents.sel', selectedId)
    else localStorage.removeItem('gt.persistentAgents.sel')
    if (!selectedId) {
      setDetail(null)
      return
    }
    window.gt.persistentAgents.get(selectedId).then(setDetail)
  }, [selectedId])
  useEffect(() => {
    if (fileKey !== 'files' && fileKey !== 'artifacts') setFileDraft(detail?.files[fileKey] || '')
  }, [detail, fileKey])
  const refreshFiles = async (dir = fileDir) => {
    if (!detail) return
    setFileEntries(await window.gt.persistentAgents.files.list(detail.id, dir))
  }
  useEffect(() => {
    setFileDir('')
    setAgentFilePath('')
    setAgentFileContent('')
    setAgentFileDirty(false)
    if (detail) window.gt.persistentAgents.files.list(detail.id, '').then(setFileEntries)
  }, [detail?.id])
  useEffect(() => {
    if (!detail) {
      setArtifacts([])
      setSelectedArtifactId(null)
      setSelectedArtifactPath(null)
      setArtifactBody(null)
      return
    }
    window.gt.persistentAgents.artifacts.list(detail.id).then((list) => {
      setArtifacts(list)
      setSelectedArtifactId((prev) => nextArtifactId(list, prev))
    })
  }, [detail?.id, detail?.updatedAt])
  useEffect(() => {
    if (detail) refreshFiles(fileDir)
  }, [fileDir]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!detail || !selectedArtifactId) {
      setSelectedArtifactPath(null)
      setArtifactBody(null)
      return
    }
    setSelectedArtifactPath(artifactDefaultPath(artifacts.find((a) => a.id === selectedArtifactId)))
  }, [detail?.id, selectedArtifactId, artifacts])
  useEffect(() => {
    if (!detail || !selectedArtifactPath) {
      setArtifactBody(null)
      return
    }
    window.gt.persistentAgents.artifacts.read(detail.id, selectedArtifactPath).then(setArtifactBody)
  }, [detail?.id, selectedArtifactPath])

  const filtered = filterPersistentAgents(agents, query)
  const selectedArtifact = artifacts.find((a) => a.id === selectedArtifactId) || null
  const artifactFile = selectedArtifact?.files.find((f) => f.path === selectedArtifactPath) || null
  const refreshArtifacts = async () => {
    if (!detail) return
    const list = await window.gt.persistentAgents.artifacts.list(detail.id)
    setArtifacts(list)
    setSelectedArtifactId((prev) => nextArtifactId(list, prev))
  }
  const renderArtifactBody = () => {
    if (!selectedArtifact) {
      return (
        <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">
          No artifacts yet.
        </div>
      )
    }
    if (!selectedArtifactPath) {
      return (
        <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">
          Select an artifact file.
        </div>
      )
    }
    if (!artifactBody) {
      return <div className="p-4 text-[12px] text-zinc-600">Loading...</div>
    }
    if (!artifactBody.ok) {
      return <div className="p-4 text-[12px] text-[var(--gt-red)]">{artifactBody.reason}</div>
    }
    if (artifactBody.kind === 'markdown') {
      return (
        <div className="h-full overflow-auto p-5">
          <Markdown>{artifactBody.content}</Markdown>
        </div>
      )
    }
    if (artifactBody.kind === 'json') {
      let pretty = artifactBody.content
      try {
        pretty = JSON.stringify(JSON.parse(artifactBody.content), null, 2)
      } catch {
        /* keep raw */
      }
      return (
        <pre className="h-full overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-relaxed text-[var(--gt-text-soft)]">
          {pretty}
        </pre>
      )
    }
    if (artifactBody.kind === 'image' && artifactBody.dataUrl) {
      return (
        <div className="flex h-full items-center justify-center overflow-auto bg-[var(--gt-code-bg)] p-4">
          <img
            src={artifactBody.dataUrl}
            alt={artifactFile?.name || 'artifact'}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      )
    }
    if (artifactBody.kind === 'html') {
      return (
        <iframe
          sandbox=""
          srcDoc={artifactBody.content}
          className="h-full w-full border-0 bg-white"
          title={artifactFile?.name || 'artifact'}
        />
      )
    }
    return (
      <pre className="h-full overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-relaxed text-[var(--gt-text-soft)]">
        {artifactBody.content}
      </pre>
    )
  }

  const launch = async (engine: Engine, model?: string, launchMode: LaunchMode = 'terminal') => {
    if (!detail) return
    if (launchMode === 'process') {
      const r = await window.gt.persistentAgents.run(detail.id, task, engine, model)
      if ('error' in r) {
        setErr(r.error)
        return
      }
      setTask('')
      await loadList()
      navigateTo('runs', { runId: r.id })
      return
    }
    const r = await window.gt.persistentAgents.launchPrompt(
      detail.id,
      task,
      ctx.repoRoot,
      engine,
      model,
    )
    if ('error' in r) {
      setErr(r.error)
      return
    }
    openPromptInTerminal({
      engine,
      cwd: ctx.repoRoot,
      name: r.agent.title,
      prompt: r.prompt,
      remote: remoteForTabContext(ctx),
    })
    setTask('')
    await loadList()
  }

  const saveFile = async () => {
    if (!detail || fileKey === 'files' || fileKey === 'artifacts') return
    const r = await window.gt.persistentAgents.updateFile(detail.id, fileKey, fileDraft)
    if ('error' in r) {
      setErr(r.error)
      return
    }
    setDetail(r)
    await loadList()
  }
  const openAgentFile = async (path: string) => {
    if (!detail) return
    setAgentFilePath(path)
    const r = await window.gt.persistentAgents.files.read(detail.id, path)
    if (!r.ok) {
      setAgentFileContent('')
      setAgentFileErr(r.reason || 'Unable to read file')
      setAgentFileDirty(false)
      return
    }
    setAgentFileContent(r.content)
    setAgentFileErr('')
    setAgentFileDirty(false)
  }
  const saveAgentFile = async () => {
    if (!detail || !agentFilePath || agentFileErr) return
    if (await window.gt.persistentAgents.files.write(detail.id, agentFilePath, agentFileContent)) {
      setAgentFileDirty(false)
      await refreshFiles()
      const fresh = await window.gt.persistentAgents.get(detail.id)
      if (fresh) setDetail(fresh)
    }
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        className="flex shrink-0 flex-col border-r border-[var(--gt-border)] bg-[var(--gt-panel)]/30"
        style={{ width: railW.width }}
      >
        <div className="space-y-1.5 border-b border-[var(--gt-border)] p-2">
          {headerSlot}
          <div className="flex items-center gap-1.5">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search persistent agents…"
              className="min-w-0 flex-1 rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-[var(--gt-accent)]/60 focus:outline-none"
            />
            <button
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-accent)]/40 bg-[var(--gt-accent)]/10 px-2 py-1 text-[11px] font-semibold text-[var(--gt-accent-light)] hover:bg-[var(--gt-accent)]/20"
            >
              <Plus size={12} strokeWidth={2.5} />
              New
            </button>
          </div>
          <div className="rounded-md border border-[var(--gt-border)] p-2 text-[10.5px] leading-4 text-zinc-500">
            Global memory agents live in{' '}
            <span className="font-mono">~/.config/TerMinal/persistent-agents</span>.
          </div>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-3 text-[11px] text-zinc-600">No persistent agents yet.</div>
          ) : (
            filtered.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelectedId(a.id)}
                className={`flex w-full items-center gap-2 border-b border-[var(--gt-border)]/40 px-2.5 py-2 text-left ${
                  selectedId === a.id ? 'bg-[var(--gt-accent)]/20' : 'hover:bg-white/5'
                }`}
              >
                <Bot size={14} strokeWidth={2} className="shrink-0 text-[var(--gt-accent-light)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold text-zinc-100">
                    {a.title}
                  </span>
                  <span className="block truncate text-[10.5px] text-zinc-600">
                    {a.lastRunAt ? `ran ${fmtRelative(a.lastRunAt)}` : a.description || a.id}
                  </span>
                </span>
                <EngineLogo engine={a.engine} size={12} className="opacity-80" />
              </button>
            ))
          )}
        </nav>
      </aside>
      <ResizeHandle onMouseDown={railW.onResizeStart} />

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {!detail ? (
          <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">
            Create or select a persistent agent.
          </div>
        ) : (
          <>
            <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--gt-border)] px-5 py-3">
              <Bot size={18} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
              <h2 className="text-[14px] font-bold text-zinc-100">{detail.title}</h2>
              <span className="font-mono text-[10px] text-zinc-600">{detail.id}</span>
              <EngineLogo engine={detail.engine} size={13} />
              {detail.model && <span className="text-[10px] text-zinc-600">{detail.model}</span>}
              <div className="flex-1" />
              <button
                onClick={() => setFileKey('files')}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--gt-border)] px-2.5 text-[12px] text-zinc-300 hover:border-[var(--gt-accent)]/60"
              >
                <FolderOpen size={12} strokeWidth={2} />
                Files
              </button>
              <button
                onClick={async () => {
                  if (!confirm(`Delete persistent agent "${detail.title}"?`)) return
                  await window.gt.persistentAgents.remove(detail.id)
                  setSelectedId(null)
                  setDetail(null)
                  await loadList()
                }}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--gt-border)] px-2.5 text-[12px] text-zinc-400 hover:border-[var(--gt-red)]/60 hover:text-[var(--gt-red)]"
              >
                <Trash2 size={12} strokeWidth={2} />
              </button>
            </header>
            {detail.description && (
              <div className="border-b border-[var(--gt-border)]/60 px-5 py-2 text-[12px] text-zinc-400">
                {detail.description}
              </div>
            )}
            <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-[var(--gt-border)] p-3">
              <textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                rows={3}
                placeholder="Task for this run. Leave blank to continue current STATE.md."
                className="resize-none rounded-lg border border-[var(--gt-border)] bg-black/30 px-3 py-2 text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:border-[var(--gt-accent)]/60 focus:outline-none"
              />
              <button
                onClick={() => setPickingRun(true)}
                className="inline-flex h-full min-w-28 items-center justify-center gap-1 rounded-lg bg-[var(--gt-accent)] px-3 text-[12px] font-semibold text-white hover:opacity-90"
              >
                <Play size={13} strokeWidth={2.5} />
                Run
              </button>
            </div>
            {err && (
              <div className="border-b border-[var(--gt-border)] px-5 py-2 text-[11px] text-[var(--gt-red)]">
                {err}
              </div>
            )}
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center gap-1 border-b border-[var(--gt-border)] px-3 py-1.5">
                {(
                  [
                    'instructions',
                    'memory',
                    'state',
                    'journal',
                    'artifacts',
                    'files',
                  ] as PersistentViewKey[]
                ).map((k) => (
                  <button
                    key={k}
                    onClick={() => setFileKey(k)}
                    className={`rounded-md px-2 py-1 text-[11px] capitalize ${
                      fileKey === k
                        ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                        : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'
                    }`}
                  >
                    {k}
                  </button>
                ))}
                <div className="flex-1" />
                {fileKey === 'artifacts' ? (
                  <button
                    onClick={refreshArtifacts}
                    className="rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/60"
                  >
                    Refresh
                  </button>
                ) : fileKey === 'files' ? (
                  <button
                    onClick={saveAgentFile}
                    disabled={!agentFilePath || !agentFileDirty || !!agentFileErr}
                    className="rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/60 disabled:opacity-40"
                  >
                    Save scoped file
                  </button>
                ) : (
                  <button
                    onClick={saveFile}
                    className="rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/60"
                  >
                    Save file
                  </button>
                )}
              </div>
              {fileKey === 'artifacts' ? (
                <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)]">
                  <aside className="min-h-0 overflow-y-auto border-r border-[var(--gt-border)] bg-[var(--gt-panel)]/30">
                    {artifacts.length === 0 ? (
                      <div className="p-4 text-[12px] leading-relaxed text-zinc-600">
                        No artifacts yet. Persistent agents should write durable output to{' '}
                        <span className="font-mono">artifacts/&lt;run&gt;/report.md</span>.
                      </div>
                    ) : (
                      artifacts.map((artifact) => (
                        <button
                          key={artifact.id}
                          onClick={() => setSelectedArtifactId(artifact.id)}
                          className={`block w-full border-b border-[var(--gt-border)]/50 px-3 py-2 text-left ${
                            selectedArtifactId === artifact.id
                              ? 'bg-[var(--gt-accent)]/20'
                              : 'hover:bg-white/5'
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <ClipboardList
                              size={12}
                              strokeWidth={2}
                              className="shrink-0 text-[var(--gt-accent-light)]"
                            />
                            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-zinc-100">
                              {artifact.title}
                            </span>
                            <Badge variant="info">{artifact.kind}</Badge>
                          </div>
                          {artifact.summary && (
                            <div className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-zinc-500">
                              {artifact.summary}
                            </div>
                          )}
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-600">
                            <span>{fmtRelative(artifact.createdAt)}</span>
                            <span>
                              {artifact.files.length} file{artifact.files.length === 1 ? '' : 's'}
                            </span>
                            {artifact.runId && (
                              <span className="truncate font-mono">
                                {artifact.runId.slice(0, 8)}
                              </span>
                            )}
                          </div>
                        </button>
                      ))
                    )}
                  </aside>
                  <section className="flex min-w-0 flex-col">
                    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-3">
                      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-zinc-200">
                        {selectedArtifact?.title || 'Artifacts'}
                      </span>
                      {artifactFile && (
                        <span className="shrink-0 font-mono text-[10px] text-zinc-600">
                          {artifactFile.name} · {fmtBytes(artifactFile.size)}
                        </span>
                      )}
                    </div>
                    {selectedArtifact && selectedArtifact.files.length > 1 && (
                      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--gt-border)] px-2 py-1">
                        {selectedArtifact.files.map((file) => (
                          <button
                            key={file.path}
                            onClick={() => setSelectedArtifactPath(file.path)}
                            className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10.5px] ${
                              selectedArtifactPath === file.path
                                ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                                : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'
                            }`}
                          >
                            <FileText size={11} strokeWidth={2} />
                            <span className="max-w-[180px] truncate">{file.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="min-h-0 flex-1 bg-[var(--gt-code-bg)]">
                      {renderArtifactBody()}
                    </div>
                  </section>
                </div>
              ) : fileKey === 'files' ? (
                <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)]">
                  <div className="min-h-0 overflow-y-auto border-r border-[var(--gt-border)] bg-[var(--gt-panel)]/30">
                    <div className="flex items-center gap-1 border-b border-[var(--gt-border)] px-2 py-1.5">
                      <button
                        onClick={() =>
                          setFileDir(
                            fileDir.includes('/') ? fileDir.slice(0, fileDir.lastIndexOf('/')) : '',
                          )
                        }
                        disabled={!fileDir}
                        className="rounded-md border border-[var(--gt-border)] px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-[var(--gt-accent)]/60 disabled:opacity-40"
                      >
                        Up
                      </button>
                      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-600">
                        /{fileDir}
                      </span>
                      <button
                        onClick={async () => {
                          if (!detail) return
                          const name = prompt('New file name')
                          if (!name) return
                          const rel = fileDir ? `${fileDir}/${name}` : name
                          await window.gt.persistentAgents.files.create(detail.id, rel, false)
                          await refreshFiles()
                        }}
                        className="rounded-md p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                        title="New file"
                      >
                        <Plus size={12} strokeWidth={2.5} />
                      </button>
                      <button
                        onClick={async () => {
                          if (!detail) return
                          const name = prompt('New folder name')
                          if (!name) return
                          const rel = fileDir ? `${fileDir}/${name}` : name
                          await window.gt.persistentAgents.files.create(detail.id, rel, true)
                          await refreshFiles()
                        }}
                        className="rounded-md p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                        title="New folder"
                      >
                        <FolderOpen size={12} strokeWidth={2} />
                      </button>
                    </div>
                    {fileEntries.map((entry) => (
                      <button
                        key={entry.path}
                        onClick={() =>
                          entry.dir ? setFileDir(entry.path) : openAgentFile(entry.path)
                        }
                        className={`group flex w-full items-center gap-1.5 border-b border-[var(--gt-border)]/40 px-2 py-1.5 text-left text-[11px] ${
                          agentFilePath === entry.path
                            ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                            : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                        }`}
                      >
                        {entry.dir ? (
                          <FolderOpen size={12} strokeWidth={2} />
                        ) : (
                          <FileText size={12} strokeWidth={2} />
                        )}
                        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                        {!entry.dir && !PROTECTED_FILES.includes(entry.path) && (
                          <span
                            onClick={async (e) => {
                              e.stopPropagation()
                              if (!detail || !confirm(`Delete ${entry.path}?`)) return
                              await window.gt.persistentAgents.files.del(detail.id, entry.path)
                              if (agentFilePath === entry.path) {
                                setAgentFilePath('')
                                setAgentFileContent('')
                              }
                              await refreshFiles()
                            }}
                            className="hidden rounded p-0.5 text-zinc-600 hover:text-[var(--gt-red)] group-hover:inline-flex"
                          >
                            <Trash2 size={10} strokeWidth={2} />
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="flex min-h-0 flex-col">
                    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-3">
                      <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-zinc-500">
                        {agentFilePath || 'Select a file'}
                      </span>
                      {agentFileDirty && (
                        <span className="text-[10px] text-[var(--gt-yellow)]">Unsaved</span>
                      )}
                    </div>
                    {agentFileErr ? (
                      <div className="p-4 text-[12px] text-[var(--gt-red)]">{agentFileErr}</div>
                    ) : (
                      <div className="min-h-0 flex-1">
                        <CodeEditor
                          value={agentFileContent}
                          onChange={(v) => {
                            setAgentFileContent(v)
                            setAgentFileDirty(true)
                          }}
                          editable={!!agentFilePath}
                          extensions={langForAgentFile(agentFilePath)}
                          wrap
                        />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="min-h-0 flex-1">
                  <CodeEditor
                    value={fileDraft}
                    onChange={setFileDraft}
                    extensions={langForAgentFile(MEMORY_FILE[fileKey])}
                    wrap
                  />
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {pickingRun && detail && (
        <EnginePicker
          title={`Run persistent · ${detail.title}`}
          showPersona={false}
          showPipeline={false}
          hint={
            <>
              Runs from the current workspace repo, while reading and updating this agent's global
              memory files under{' '}
              <code className="font-mono text-zinc-300">
                ~/.config/TerMinal/persistent-agents/{detail.id}
              </code>
              .
            </>
          }
          onClose={() => setPickingRun(false)}
          onPick={(engine, _persona, _pipeline, model, launchMode) => {
            setPickingRun(false)
            launch(engine, model, launchMode || 'terminal')
          }}
        />
      )}

      {creating && (
        <PersistentAgentEditor
          ctx={ctx}
          err={err}
          onErr={setErr}
          onClose={() => setCreating(false)}
          onCreated={async (id) => {
            setCreating(false)
            setSelectedId(id)
            await loadList()
          }}
        />
      )}
    </div>
  )
}
