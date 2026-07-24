import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Play,
  Pause,
  Pencil,
  Trash2,
  Plus,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  X,
} from 'lucide-react'
import { Badge } from '../../components/ui'
import type { BadgeTone } from '../../components/ui'
import { SkillHint } from '../../components/SkillHint'
import { useResizableWidth, ResizeHandle } from '../../components/ResizeHandle'
import type {
  Tab,
  TabContext,
  Monitor,
  MonitorType,
  MonitorState,
  MonitorNotify,
  MonitorWithState,
} from '../../lib/types'

// Monitoring tab — deterministic infra observability. Renders window.gt.monitors
// (http / tls-cert / tcp / dns / command) grouped, with per-row status, run-now,
// enable/disable, edit, delete, and an add/edit form. NOT agents/runs: monitors
// execute on their own schedule via the monitor daemon, no inference. Everything
// here is client-side state persisted through monitors.save(); zero new IPC.

// ---- type metadata ---------------------------------------------------------
const TYPE_LABEL: Record<MonitorType, string> = {
  http: 'HTTP',
  'tls-cert': 'TLS cert',
  tcp: 'TCP',
  dns: 'DNS',
  command: 'Command',
}
const TYPE_PLACEHOLDER: Record<MonitorType, string> = {
  http: 'https://example.com/health',
  'tls-cert': 'example.com:443',
  tcp: 'db.internal:5432',
  dns: 'example.com',
  command: 'curl -sf https://example.com | grep OK',
}
const TYPE_HELP: Record<MonitorType, string> = {
  http: 'A URL to GET. Non-2xx (or too slow) → fail/warn.',
  'tls-cert': 'host:port — checks certificate expiry.',
  tcp: 'host:port — checks the socket opens.',
  dns: 'A hostname to resolve.',
  command: 'A shell command. Non-zero exit → fail.',
}
const TYPES: MonitorType[] = ['http', 'tls-cert', 'tcp', 'dns', 'command']

// ---- helpers ---------------------------------------------------------------
function stateTone(status: MonitorState | null | undefined): BadgeTone {
  if (status === 'ok') return 'green'
  if (status === 'warn') return 'yellow'
  if (status === 'fail') return 'red'
  return 'mute'
}
const DOT_COLOR: Record<MonitorState, string> = {
  ok: 'var(--gt-green)',
  warn: 'var(--gt-yellow)',
  fail: 'var(--gt-red)',
}
function StatusDot({ status }: { status: MonitorState | null | undefined }) {
  const color = status ? DOT_COLOR[status] : '#52525b'
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{
        background: color,
        boxShadow: status && status !== 'ok' ? `0 0 6px ${color}` : undefined,
      }}
      title={status ?? 'no data yet'}
    />
  )
}
function healthColor(health: string): string {
  const h = health.toLowerCase()
  if (h === 'ok' || h === 'healthy' || h === 'pass' || h === 'up') return 'var(--gt-green)'
  if (h === 'warn' || h === 'degraded') return 'var(--gt-yellow)'
  if (h === 'fail' || h === 'down' || h === 'error' || h === 'critical') return 'var(--gt-red)'
  return '#52525b'
}
function reltime(ms?: number): string {
  if (!ms) return 'never'
  const s = (Date.now() - ms) / 1000
  if (s < 0) return 'just now'
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
function isStale(m: MonitorWithState): boolean {
  if (!m.state?.lastCheckedAt) return false
  return Date.now() - m.state.lastCheckedAt > m.intervalSec * 1000 * 3
}
function stripState(list: MonitorWithState[]): Monitor[] {
  return list.map(({ state: _state, ...rest }) => rest)
}
function fmtMetric(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2)
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

// ---- cert expiry (the headline fact for a TLS-cert monitor) -----------------
function certDays(m: MonitorWithState): number | null {
  const d = m.state?.metrics?.daysRemaining
  return typeof d === 'number' ? d : null
}
function expiryTone(days: number): BadgeTone {
  return days <= 5 ? 'red' : days <= 15 ? 'yellow' : 'green'
}
function expiryLabel(days: number): string {
  if (days < 0) return `expired ${-days}d ago`
  if (days === 0) return 'expires today'
  return `${days}d left`
}
function expiryPhrase(days: number): string {
  if (days < 0) return `Expired ${-days} day${-days === 1 ? '' : 's'} ago`
  if (days === 0) return 'Expires today'
  return `Expires in ${days} day${days === 1 ? '' : 's'}`
}
function fmtDate(v: unknown): string {
  if (typeof v !== 'string') return '—'
  const d = new Date(v)
  return isNaN(d.getTime()) ? v : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const DEFAULT_NOTIFY: MonitorNotify = {
  onFailure: 'normal',
  onRecovery: true,
  renotifyAfterSec: 3600,
  dailyDigest: false,
  digestHour: 9,
}

// ---- add / edit form -------------------------------------------------------
type FormState = {
  name: string
  type: MonitorType
  target: string
  intervalSec: number
  group: string
  enabled: boolean
  notify: MonitorNotify
  // typed advanced config (per type)
  warnLatencyMs: string
  bodyContains: string
  method: string
  warnDays: string
  critDays: string
  recordType: string
  expect: string
  timeoutMs: string
}

function emptyForm(): FormState {
  return {
    name: '',
    type: 'http',
    target: '',
    intervalSec: 60,
    group: '',
    enabled: true,
    notify: { ...DEFAULT_NOTIFY },
    warnLatencyMs: '',
    bodyContains: '',
    method: '',
    warnDays: '',
    critDays: '',
    recordType: '',
    expect: '',
    timeoutMs: '',
  }
}

function formFromMonitor(m: Monitor): FormState {
  const c = m.config || {}
  const str = (v: unknown) => (v === undefined || v === null ? '' : String(v))
  return {
    name: m.name,
    type: m.type,
    target: m.target,
    intervalSec: m.intervalSec,
    group: m.group ?? '',
    enabled: m.enabled,
    notify: { ...DEFAULT_NOTIFY, ...m.notify },
    warnLatencyMs: str(c.warnLatencyMs),
    bodyContains: str(c.bodyContains),
    method: str(c.method),
    warnDays: str(c.warnDays),
    critDays: str(c.critDays),
    recordType: str(c.recordType),
    expect: str(c.expect),
    timeoutMs: str(c.timeoutMs),
  }
}

// Map the typed advanced fields → the per-type config record. Empty fields are
// omitted so we don't persist meaningless keys.
function buildConfig(f: FormState): Record<string, unknown> {
  const num = (s: string): number | undefined => {
    const t = s.trim()
    if (t === '') return undefined
    const n = Number(t)
    return Number.isFinite(n) ? n : undefined
  }
  const cfg: Record<string, unknown> = {}
  const put = (k: string, v: unknown) => {
    if (v !== undefined && v !== '') cfg[k] = v
  }
  if (f.type === 'http') {
    put('warnLatencyMs', num(f.warnLatencyMs))
    put('bodyContains', f.bodyContains.trim())
    put('method', f.method.trim().toUpperCase())
  } else if (f.type === 'tls-cert') {
    put('warnDays', num(f.warnDays))
    put('critDays', num(f.critDays))
  } else if (f.type === 'dns') {
    put('recordType', f.recordType.trim().toUpperCase())
    put('expect', f.expect.trim())
  } else if (f.type === 'command') {
    put('timeoutMs', num(f.timeoutMs))
  }
  return cfg
}

const inputCls =
  'w-full rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[12px] text-zinc-100 outline-none focus:border-[var(--gt-accent)]/60'
const labelCls = 'mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500'

function MonitorForm({
  initial,
  onCancel,
  onSave,
}: {
  initial: Monitor | null
  onCancel: () => void
  onSave: (m: Monitor) => Promise<void>
}) {
  const [f, setF] = useState<FormState>(() => (initial ? formFromMonitor(initial) : emptyForm()))
  const [advanced, setAdvanced] = useState(false)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }))
  const setNotify = <K extends keyof MonitorNotify>(k: K, v: MonitorNotify[K]) =>
    setF((p) => ({ ...p, notify: { ...p.notify, [k]: v } }))

  const canSave = f.name.trim() !== '' && f.target.trim() !== '' && f.intervalSec > 0

  const submit = async () => {
    if (!canSave || saving) return
    setSaving(true)
    const m: Monitor = {
      id: initial?.id ?? crypto.randomUUID(),
      name: f.name.trim(),
      type: f.type,
      target: f.target.trim(),
      intervalSec: f.intervalSec,
      enabled: f.enabled,
      group: f.group.trim() || undefined,
      notify: f.notify,
      config: buildConfig(f),
    }
    try {
      await onSave(m)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-5 py-2.5">
        <span className="text-[13px] font-semibold text-zinc-100">
          {initial ? 'Edit monitor' : 'Add monitor'}
        </span>
        <div className="flex-1" />
        <button
          onClick={onCancel}
          className="cursor-pointer rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
          title="Cancel"
        >
          <X size={15} strokeWidth={2} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto flex max-w-xl flex-col gap-3.5">
          <div>
            <label className={labelCls}>Name</label>
            <input
              className={inputCls}
              value={f.name}
              placeholder="Production API health"
              onChange={(e) => set('name', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Type</label>
              <select
                className={`${inputCls} cursor-pointer`}
                value={f.type}
                onChange={(e) => set('type', e.target.value as MonitorType)}
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Interval (sec)</label>
              <input
                type="number"
                min={5}
                className={inputCls}
                value={f.intervalSec}
                onChange={(e) => set('intervalSec', Number(e.target.value) || 0)}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>Target</label>
            <input
              className={`${inputCls} font-mono`}
              value={f.target}
              placeholder={TYPE_PLACEHOLDER[f.type]}
              onChange={(e) => set('target', e.target.value)}
            />
            <p className="mt-1 text-[10.5px] leading-snug text-zinc-600">{TYPE_HELP[f.type]}</p>
          </div>

          <div>
            <label className={labelCls}>Group (optional)</label>
            <input
              className={inputCls}
              value={f.group}
              placeholder="Ungrouped monitors live under “Monitors”"
              onChange={(e) => set('group', e.target.value)}
            />
          </div>

          {/* Notifications */}
          <div className="rounded-lg border border-[var(--gt-border)] bg-black/20 p-3">
            <div className="mb-2.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Notifications
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>On failure</label>
                <select
                  className={`${inputCls} cursor-pointer`}
                  value={f.notify.onFailure}
                  onChange={(e) =>
                    setNotify('onFailure', e.target.value as MonitorNotify['onFailure'])
                  }
                >
                  <option value="urgent">Urgent</option>
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                  <option value="off">Off</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Renotify after (sec)</label>
                <input
                  type="number"
                  min={0}
                  className={inputCls}
                  value={f.notify.renotifyAfterSec}
                  onChange={(e) => setNotify('renotifyAfterSec', Number(e.target.value) || 0)}
                />
              </div>
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-[12px] text-zinc-300">
              <input
                type="checkbox"
                checked={f.notify.onRecovery}
                onChange={(e) => setNotify('onRecovery', e.target.checked)}
              />
              Notify on recovery
            </label>
            <div className="mt-2 flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-zinc-300">
                <input
                  type="checkbox"
                  checked={f.notify.dailyDigest}
                  onChange={(e) => setNotify('dailyDigest', e.target.checked)}
                />
                Daily digest
              </label>
              {f.notify.dailyDigest && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-zinc-500">at hour</span>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    className="w-16 rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[12px] text-zinc-100 outline-none focus:border-[var(--gt-accent)]/60"
                    value={f.notify.digestHour}
                    onChange={(e) =>
                      setNotify(
                        'digestHour',
                        Math.max(0, Math.min(23, Number(e.target.value) || 0)),
                      )
                    }
                  />
                </div>
              )}
            </div>
          </div>

          {/* Advanced per-type config */}
          <div className="rounded-lg border border-[var(--gt-border)] bg-black/20">
            <button
              onClick={() => setAdvanced((a) => !a)}
              className="flex w-full cursor-pointer items-center gap-1.5 px-3 py-2 text-left transition-colors hover:bg-white/5"
            >
              {advanced ? (
                <ChevronDown size={12} strokeWidth={2.5} className="text-zinc-500" />
              ) : (
                <ChevronRight size={12} strokeWidth={2.5} className="text-zinc-500" />
              )}
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Advanced — {TYPE_LABEL[f.type]} config
              </span>
            </button>
            {advanced && (
              <div className="grid grid-cols-2 gap-3 px-3 pb-3">
                {f.type === 'http' && (
                  <>
                    <div>
                      <label className={labelCls}>Warn latency (ms)</label>
                      <input
                        className={inputCls}
                        value={f.warnLatencyMs}
                        placeholder="800"
                        onChange={(e) => set('warnLatencyMs', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Method</label>
                      <input
                        className={inputCls}
                        value={f.method}
                        placeholder="GET"
                        onChange={(e) => set('method', e.target.value)}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className={labelCls}>Body contains</label>
                      <input
                        className={inputCls}
                        value={f.bodyContains}
                        placeholder='"status":"ok"'
                        onChange={(e) => set('bodyContains', e.target.value)}
                      />
                    </div>
                  </>
                )}
                {f.type === 'tls-cert' && (
                  <>
                    <div>
                      <label className={labelCls}>Warn days</label>
                      <input
                        className={inputCls}
                        value={f.warnDays}
                        placeholder="21"
                        onChange={(e) => set('warnDays', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Crit days</label>
                      <input
                        className={inputCls}
                        value={f.critDays}
                        placeholder="7"
                        onChange={(e) => set('critDays', e.target.value)}
                      />
                    </div>
                  </>
                )}
                {f.type === 'dns' && (
                  <>
                    <div>
                      <label className={labelCls}>Record type</label>
                      <input
                        className={inputCls}
                        value={f.recordType}
                        placeholder="A"
                        onChange={(e) => set('recordType', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Expect</label>
                      <input
                        className={inputCls}
                        value={f.expect}
                        placeholder="93.184.216.34"
                        onChange={(e) => set('expect', e.target.value)}
                      />
                    </div>
                  </>
                )}
                {f.type === 'command' && (
                  <div>
                    <label className={labelCls}>Timeout (ms)</label>
                    <input
                      className={inputCls}
                      value={f.timeoutMs}
                      placeholder="10000"
                      onChange={(e) => set('timeoutMs', e.target.value)}
                    />
                  </div>
                )}
                {f.type === 'tcp' && (
                  <p className="col-span-2 text-[11px] text-zinc-600">
                    TCP checks have no extra config — it just opens the socket.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              disabled={!canSave || saving}
              onClick={submit}
              className="cursor-pointer rounded-md bg-[var(--gt-accent)] px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? 'Saving…' : initial ? 'Save changes' : 'Add monitor'}
            </button>
            <button
              onClick={onCancel}
              className="cursor-pointer rounded-md border border-[var(--gt-border)] px-3 py-1.5 text-[12px] text-zinc-300 transition-colors hover:bg-white/5"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---- detail pane -----------------------------------------------------------
function MonitorDetail({ m }: { m: MonitorWithState }) {
  const st = m.state
  const config = Object.entries(m.config || {})
  const metrics = st?.metrics ? Object.entries(st.metrics) : []
  const history = st?.history ?? []
  const recent = history.slice(-30)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
      <div className="mx-auto max-w-2xl">
        {/* summary */}
        <div className="mb-4 flex items-start gap-2.5">
          <StatusDot status={st?.status} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold text-zinc-100">{m.name}</span>
              <Badge tone={stateTone(st?.status)}>{st?.status ?? 'no data'}</Badge>
              {!m.enabled && <Badge tone="mute">disabled</Badge>}
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-zinc-500">{m.target}</div>
            {st?.summary && (
              <div className="mt-1.5 text-[12.5px] leading-relaxed text-zinc-300">{st.summary}</div>
            )}
          </div>
        </div>

        {/* cert expiry — the headline fact for a TLS-cert monitor */}
        {m.type === 'tls-cert' && certDays(m) !== null && (
          <div
            className="mb-4 flex items-center justify-between rounded-lg border px-4 py-3"
            style={{
              borderColor: `color-mix(in srgb, ${DOT_COLOR[st!.status]} 40%, transparent)`,
              background: `color-mix(in srgb, ${DOT_COLOR[st!.status]} 10%, transparent)`,
            }}
          >
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Certificate
              </div>
              <div
                className="mt-0.5 text-[18px] font-semibold"
                style={{ color: DOT_COLOR[st!.status] }}
              >
                {expiryPhrase(certDays(m)!)}
              </div>
            </div>
            {st?.metrics?.notAfter != null && (
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wide text-zinc-600">Valid until</div>
                <div className="mt-0.5 font-mono text-[12px] text-zinc-300">
                  {fmtDate(st.metrics.notAfter)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* history strip */}
        {recent.length > 0 && (
          <div className="mb-4">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Recent history
            </div>
            <div className="flex flex-wrap gap-[3px]">
              {recent.map((h, i) => (
                <span
                  key={i}
                  className="h-4 w-1.5 rounded-sm"
                  style={{ background: DOT_COLOR[h.status as MonitorState] ?? '#52525b' }}
                  title={`${h.status} · ${reltime(h.at)}`}
                />
              ))}
            </div>
          </div>
        )}

        {/* metrics */}
        {metrics.length > 0 && (
          <div className="mb-4">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Metrics
            </div>
            <div className="flex flex-wrap gap-1.5">
              {metrics.map(([k, v]) => (
                <span
                  key={k}
                  className="inline-flex items-baseline gap-1 rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-1"
                >
                  <span className="text-[9.5px] uppercase tracking-wide text-zinc-600">{k}</span>
                  <span className="font-mono text-[11.5px] text-zinc-200">{fmtMetric(v)}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* rich sections (e.g. command checks) */}
        {st?.detail?.sections?.map((section, si) => (
          <div key={si} className="mb-4">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              {section.title}
            </div>
            <div className="flex flex-col gap-1">
              {section.items.map((item, ii) => (
                <div
                  key={ii}
                  className="flex items-center gap-2 rounded-md border border-[var(--gt-border)] bg-black/20 px-2.5 py-1.5"
                >
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ background: healthColor(item.health) }}
                  />
                  <span className="text-[12px] text-zinc-200">{item.label}</span>
                  {item.meta && Object.keys(item.meta).length > 0 && (
                    <span className="ml-auto flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                      {Object.entries(item.meta).map(([mk, mv]) => (
                        <span key={mk} className="font-mono">
                          {mk}: {fmtMetric(mv)}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* config */}
        <div className="mb-4">
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Config
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-[var(--gt-border)] bg-black/20 p-3 text-[12px]">
            <div className="flex justify-between gap-4">
              <span className="shrink-0 text-zinc-500">Type</span>
              <span className="min-w-0 break-words text-right text-zinc-200">{TYPE_LABEL[m.type]}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="shrink-0 text-zinc-500">Target</span>
              <span className="min-w-0 break-all text-right font-mono text-zinc-200">{m.target}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="shrink-0 text-zinc-500">Interval</span>
              <span className="tabular-nums text-zinc-200">{m.intervalSec}s</span>
            </div>
            {m.group && (
              <div className="flex justify-between gap-4">
                <span className="shrink-0 text-zinc-500">Group</span>
                <span className="min-w-0 break-words text-right text-zinc-200">{m.group}</span>
              </div>
            )}
            {config.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <span className="shrink-0 text-zinc-500">{k}</span>
                <span className="min-w-0 break-all text-right font-mono text-zinc-200">
                  {fmtMetric(v)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* notify */}
        <div>
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Notifications
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={m.notify.onFailure === 'off' ? 'mute' : 'blue'}>
              fail: {m.notify.onFailure}
            </Badge>
            {m.notify.onRecovery && <Badge tone="green">recovery</Badge>}
            <Badge tone="mute">renotify {m.notify.renotifyAfterSec}s</Badge>
            {m.notify.dailyDigest && <Badge tone="mute">digest @ {m.notify.digestHour}h</Badge>}
          </div>
        </div>

        {st?.lastCheckedAt && (
          <div className="mt-4 text-[10.5px] text-zinc-600">
            Last checked {reltime(st.lastCheckedAt)}
          </div>
        )}
      </div>
    </div>
  )
}

// ---- monitor row -----------------------------------------------------------
function MonitorRow({
  m,
  selected,
  busy,
  onSelect,
  onRun,
  onToggle,
  onEdit,
  onDelete,
}: {
  m: MonitorWithState
  selected: boolean
  busy: boolean
  onSelect: () => void
  onRun: () => void
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const st = m.state
  const stale = isStale(m)
  return (
    <div
      onClick={onSelect}
      className={`group relative flex cursor-pointer items-start gap-2 rounded-md px-2.5 py-1.5 transition-colors ${
        selected ? 'bg-[var(--gt-accent)]/20' : 'hover:bg-white/5'
      } ${m.enabled ? '' : 'opacity-55'}`}
    >
      <StatusDot status={st?.status} />
      <div className="min-w-0 flex-1">
        {/* line 1 — name, type, stale, time */}
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-zinc-100">
            {m.name}
          </span>
          {m.type === 'tls-cert' && certDays(m) !== null && (
            <Badge tone={expiryTone(certDays(m)!)}>{expiryLabel(certDays(m)!)}</Badge>
          )}
          <Badge tone="mute">{TYPE_LABEL[m.type]}</Badge>
          {stale && <Badge tone="yellow">stale</Badge>}
          <span className="shrink-0 text-[9.5px] tabular-nums text-zinc-700">
            {reltime(st?.lastCheckedAt)}
          </span>
        </div>
        {/* line 2 — target then summary, each truncating independently */}
        <div className="mt-0.5 flex items-center gap-2 text-[10.5px]">
          <span className="min-w-0 max-w-[55%] shrink-0 truncate font-mono text-zinc-600">
            {m.target}
          </span>
          {st?.summary && (
            <span className="min-w-0 flex-1 truncate text-zinc-500">{st.summary}</span>
          )}
        </div>
      </div>
      {/* actions — overlaid on the right, revealed on hover. Absolutely
          positioned so they reserve NO layout space at rest (an in-flow hidden
          bar left an awkward gap between the badge/time and the row edge). */}
      <div
        className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-black/50 px-1 py-0.5 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onRun}
          disabled={busy}
          title="Run now"
          className="cursor-pointer rounded p-1 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-100 disabled:opacity-40"
        >
          <RefreshCw size={12} strokeWidth={2} className={busy ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={onToggle}
          title={m.enabled ? 'Disable' : 'Enable'}
          className="cursor-pointer rounded p-1 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-100"
        >
          {m.enabled ? <Pause size={12} strokeWidth={2} /> : <Play size={12} strokeWidth={2} />}
        </button>
        <button
          onClick={onEdit}
          title="Edit"
          className="cursor-pointer rounded p-1 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-100"
        >
          <Pencil size={12} strokeWidth={2} />
        </button>
        <button
          onClick={onDelete}
          title="Delete"
          className="cursor-pointer rounded p-1 text-zinc-500 transition-colors hover:bg-white/10 hover:text-[var(--gt-red)]"
        >
          <Trash2 size={12} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

// ---- main tab --------------------------------------------------------------
function MonitoringTab(_: { ctx: TabContext }) {
  const [monitors, setMonitors] = useState<MonitorWithState[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Monitor | null>(null)
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const railW = useResizableWidth('gt.monitoringRailWidth', 384, { min: 280, max: 640 })

  const load = () => {
    window.gt.monitors
      .list()
      .then((list) => setMonitors(list))
      .catch(() => {})
  }
  useEffect(() => {
    load()
    const t = setInterval(load, 15_000)
    return () => clearInterval(t)
  }, [])

  // Group by `group`; list is already sorted worst-first, so preserve order.
  const groups = useMemo(() => {
    const map = new Map<string, MonitorWithState[]>()
    for (const m of monitors ?? []) {
      const g = m.group?.trim() || 'Monitors'
      const arr = map.get(g) ?? []
      arr.push(m)
      map.set(g, arr)
    }
    return [...map.entries()]
  }, [monitors])

  const selected = monitors?.find((m) => m.id === selectedId) ?? null
  const showForm = adding || editing !== null

  const persist = async (next: MonitorWithState[]) => {
    setMonitors(next)
    await window.gt.monitors.save(stripState(next)).catch(() => {})
  }

  const handleSave = async (m: Monitor) => {
    const current = monitors ?? []
    const exists = current.some((x) => x.id === m.id)
    const next: MonitorWithState[] = exists
      ? current.map((x) => (x.id === m.id ? { ...m, state: x.state } : x))
      : [...current, { ...m, state: null }]
    await window.gt.monitors.save(stripState(next)).catch(() => {})
    setAdding(false)
    setEditing(null)
    setSelectedId(m.id)
    load()
  }

  const handleRun = async (id: string) => {
    setBusyId(id)
    try {
      const list = await window.gt.monitors.run(id)
      setMonitors(list)
    } catch {
      /* ignore */
    } finally {
      setBusyId(null)
    }
  }

  const handleToggle = async (m: MonitorWithState) => {
    const next = (monitors ?? []).map((x) => (x.id === m.id ? { ...x, enabled: !x.enabled } : x))
    await persist(next)
  }

  const handleDelete = async (m: MonitorWithState) => {
    if (!confirm(`Delete monitor “${m.name}”?`)) return
    const next = (monitors ?? []).filter((x) => x.id !== m.id)
    if (selectedId === m.id) setSelectedId(null)
    await persist(next)
  }

  const failingCount = (monitors ?? []).filter(
    (m) => m.enabled && m.state?.status === 'fail',
  ).length

  return (
    <div className="flex h-full min-h-0 bg-[var(--gt-bg)]">
      {/* list */}
      <aside
        className="flex shrink-0 flex-col border-r border-[var(--gt-border)] bg-[var(--gt-panel)]"
        style={{ width: railW.width }}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-3 py-2">
          <Activity size={14} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
          <span className="text-[12px] font-semibold text-zinc-200">Monitoring</span>
          <span className="text-[11px] text-zinc-600">{monitors?.length ?? 0}</span>
          {failingCount > 0 && <Badge tone="red">{failingCount} failing</Badge>}
          <div className="flex-1" />
          <button
            onClick={() => {
              setEditing(null)
              setAdding(true)
            }}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-200 transition-colors hover:border-[var(--gt-accent)]/60 hover:bg-white/5"
          >
            <Plus size={12} strokeWidth={2.5} />
            Add monitor
          </button>
        </div>
        <div className="shrink-0 border-b border-[var(--gt-border)] p-2">
          <SkillHint>
            Monitors run on their own schedule via the monitor daemon — no agent, no inference. For
            automation, use a Schedule.
          </SkillHint>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {monitors === null ? (
            <div className="px-2 py-3 text-[11px] text-zinc-600">Loading monitors…</div>
          ) : monitors.length === 0 ? (
            <div className="px-2 py-3 text-[11px] leading-relaxed text-zinc-600">
              No monitors yet. Add an HTTP, TLS-cert, TCP, DNS, or command check — it runs
              deterministically on its own interval and reports up/warn/down here.
            </div>
          ) : (
            groups.map(([group, items]) => (
              <div key={group} className="mb-3">
                <div className="mb-1 flex items-center gap-1.5 px-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                    {group}
                  </span>
                  <span className="text-zinc-700">·</span>
                  <span className="text-[10px] tabular-nums text-zinc-600">{items.length}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  {items.map((m) => (
                    <MonitorRow
                      key={m.id}
                      m={m}
                      selected={selectedId === m.id && !showForm}
                      busy={busyId === m.id}
                      onSelect={() => {
                        setAdding(false)
                        setEditing(null)
                        setSelectedId(m.id)
                      }}
                      onRun={() => handleRun(m.id)}
                      onToggle={() => handleToggle(m)}
                      onEdit={() => {
                        setAdding(false)
                        setSelectedId(m.id)
                        setEditing(m)
                      }}
                      onDelete={() => handleDelete(m)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
      <ResizeHandle onMouseDown={railW.onResizeStart} />

      {/* right pane */}
      <section className="flex min-w-0 flex-1 flex-col">
        {showForm ? (
          <MonitorForm
            initial={editing}
            onCancel={() => {
              setAdding(false)
              setEditing(null)
            }}
            onSave={handleSave}
          />
        ) : selected ? (
          <>
            <header className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-6 py-2.5">
              <StatusDot status={selected.state?.status} />
              <span className="text-[13px] font-semibold text-zinc-100">{selected.name}</span>
              <Badge tone="mute">{TYPE_LABEL[selected.type]}</Badge>
              <div className="flex-1" />
              <button
                onClick={() => handleRun(selected.id)}
                disabled={busyId === selected.id}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-200 transition-colors hover:border-[var(--gt-accent)]/60 hover:bg-white/5 disabled:opacity-40"
              >
                <RefreshCw
                  size={11}
                  strokeWidth={2}
                  className={busyId === selected.id ? 'animate-spin' : ''}
                />
                Run now
              </button>
              <button
                onClick={() => handleToggle(selected)}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-200 transition-colors hover:border-[var(--gt-accent)]/60 hover:bg-white/5"
              >
                {selected.enabled ? (
                  <>
                    <Pause size={11} strokeWidth={2} />
                    Disable
                  </>
                ) : (
                  <>
                    <Play size={11} strokeWidth={2} />
                    Enable
                  </>
                )}
              </button>
              <button
                onClick={() => setEditing(selected)}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-200 transition-colors hover:border-[var(--gt-accent)]/60 hover:bg-white/5"
              >
                <Pencil size={11} strokeWidth={2} />
                Edit
              </button>
            </header>
            <MonitorDetail m={selected} />
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center text-[12px] text-zinc-600">
            <Activity size={28} strokeWidth={1.5} className="mb-3 text-zinc-700" />
            <div className="max-w-md leading-relaxed">
              Deterministic infra monitoring — HTTP, TLS certs, TCP, DNS, and shell-command checks.
              Pick a monitor on the left to see its status, metrics, and history, or add a new one.
              This is not agents or runs: checks execute on their own schedule via the monitor
              daemon, no inference.
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

const tab: Tab = {
  id: 'monitoring',
  title: 'Monitoring',
  icon: Activity,
  order: 3.55, // between Schedules (3.5) and Reports (3.6) — its own deterministic surface
  appliesTo: () => true,
  badge: async (gt) => {
    try {
      const list = await gt.monitors.list()
      return list.filter((m) => m.enabled && m.state?.status === 'fail').length
    } catch {
      return 0
    }
  },
  Component: MonitoringTab,
}
export default tab
