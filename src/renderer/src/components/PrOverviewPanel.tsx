import { useEffect, useMemo, useRef, useState } from 'react'
import { EyeOff, Eye, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Empty } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import type {
  PrAggregates,
  PrClassTotals,
  PrFileChange,
  PrFileClass,
  PrOverview,
  Review,
} from '../lib/types'

// The panel a reviewer lands on when they open a PR — the read that decides HOW
// to review before a single diff line is read.
//
// Everything here comes from one `mrs:overview` call (src/shared/pr-overview.ts).
// The noise toggle never hides a number: whatever is filtered out is restated as
// a count, because a reviewer who cannot see that 4,000 lines were removed from
// the total has been misled rather than helped.

const CLASS_COLOR: Record<PrFileClass, string> = {
  source: 'var(--gt-accent)',
  test: 'var(--gt-green)',
  docs: 'var(--gt-blue)',
  lockfile: 'var(--gt-text-faint)',
  generated: 'var(--gt-text-faint)',
  vendored: 'var(--gt-text-faint)',
  snapshot: 'var(--gt-text-faint)',
}

const NOISE_CLASSES: PrFileClass[] = ['lockfile', 'generated', 'vendored', 'snapshot']

const LEGEND: { cls: PrFileClass; label: string }[] = [
  { cls: 'source', label: 'Source' },
  { cls: 'test', label: 'Tests' },
  { cls: 'docs', label: 'Docs' },
  { cls: 'lockfile', label: 'Noise' },
]

const churn = (t: { adds: number; dels: number }): number => t.adds + t.dels
const pct = (n: number): string => `${Math.round(n * 100)}%`
const num = (n: number): string => n.toLocaleString()

/** Bucketed block size. A true treemap needs a layout pass and a chart library;
 *  four area steps carry the same "which file is the change" signal for free. */
function span(c: number): number {
  if (c >= 400) return 4
  if (c >= 120) return 3
  if (c >= 30) return 2
  return 1
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-[9.5px] font-bold uppercase tracking-[0.12em] text-zinc-500">
      {children}
    </div>
  )
}

function Delta({ adds, dels, big = false }: { adds: number; dels: number; big?: boolean }) {
  const size = big ? 'text-[17px]' : 'text-[11px]'
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold tabular-nums ${size}`}>
      <span style={{ color: 'var(--gt-green)' }}>+{num(adds)}</span>
      <span style={{ color: 'var(--gt-red)' }}>&minus;{num(dels)}</span>
    </span>
  )
}

/** One horizontal bar: adds and dels as a split fill, scaled against the row
 *  with the most churn so the shape of the change is readable at a glance. */
function Bar({
  label,
  total,
  max,
  adds,
  dels,
  files,
  indent = false,
}: {
  label: string
  total: number
  max: number
  adds: number
  dels: number
  files: number
  indent?: boolean
}) {
  const width = max > 0 ? Math.max(2, (total / max) * 100) : 0
  const addShare = total > 0 ? (adds / total) * 100 : 0
  return (
    <div className={`flex items-center gap-2 py-[3px] ${indent ? 'pl-3' : ''}`}>
      <span
        className="w-28 shrink-0 truncate font-mono text-[10.5px] text-zinc-400"
        title={`${label} — ${files} file${files === 1 ? '' : 's'}`}
      >
        {label}
      </span>
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-sm bg-white/10">
        <div className="flex h-full" style={{ width: `${width}%` }}>
          <div style={{ width: `${addShare}%`, background: 'var(--gt-green)' }} />
          <div style={{ width: `${100 - addShare}%`, background: 'var(--gt-red)' }} />
        </div>
      </div>
      <span className="w-24 shrink-0 text-right text-[10.5px] tabular-nums text-zinc-500">
        +{num(adds)} &minus;{num(dels)}
      </span>
    </div>
  )
}

function ChangeBlockMap({
  files,
  selected,
  onSelect,
}: {
  files: PrFileChange[]
  selected: string
  onSelect: (path: string) => void
}) {
  if (files.length === 0) return <Empty>Nothing to map.</Empty>
  return (
    <div
      role="list"
      aria-label="Change block map — one block per file, sized by lines changed"
      className="grid gap-[3px]"
      style={{
        gridTemplateColumns: 'repeat(auto-fill, 18px)',
        gridAutoRows: '18px',
        gridAutoFlow: 'dense',
      }}
    >
      {files.map((f) => {
        const c = churn(f)
        const s = span(c)
        const on = selected === f.path
        // Intensity carries deletion-heaviness: a mostly-red file reads darker,
        // which is the second thing a reviewer wants after "how big".
        const delShare = c > 0 ? f.dels / c : 0
        return (
          <button
            key={f.path}
            role="listitem"
            type="button"
            onClick={() => onSelect(f.path)}
            title={`${f.path} — +${f.adds} −${f.dels} · ${f.cls}${f.binary ? ' · binary' : ''}`}
            aria-label={`${f.path}, ${f.adds} added, ${f.dels} removed, ${f.cls}`}
            aria-pressed={on}
            className="rounded-[2px] outline-none ring-offset-0 focus-visible:ring-2 focus-visible:ring-[var(--gt-accent-light)]"
            style={{
              gridColumn: `span ${s}`,
              gridRow: `span ${s}`,
              background: CLASS_COLOR[f.cls],
              opacity: on ? 1 : 0.45 + 0.4 * (1 - delShare),
              boxShadow: on ? '0 0 0 2px var(--gt-accent-light)' : undefined,
            }}
          />
        )
      })}
    </div>
  )
}

function DirectoryBars({ agg }: { agg: PrAggregates }) {
  const top = agg.byDirectory.filter((d) => d.depth === 1)
  const max = Math.max(1, ...top.map(churn))
  return (
    <div>
      {top.slice(0, 8).map((d) => (
        <div key={d.path}>
          <Bar
            label={d.path}
            total={churn(d)}
            max={max}
            adds={d.adds}
            dels={d.dels}
            files={d.files}
          />
          {agg.byDirectory
            .filter((s) => s.depth === 2 && s.path.startsWith(`${d.path}/`))
            .slice(0, 4)
            .map((s) => (
              <Bar
                key={s.path}
                label={s.path.slice(d.path.length + 1)}
                total={churn(s)}
                max={max}
                adds={s.adds}
                dels={s.dels}
                files={s.files}
                indent
              />
            ))}
        </div>
      ))}
    </div>
  )
}

function NoiseSummary({ noise }: { noise: PrOverview['noise'] }) {
  const parts = NOISE_CLASSES.map((c) => ({ cls: c, t: noise.byClass[c] as PrClassTotals }))
    .filter((p) => p.t.files > 0)
    .map((p) => `${p.t.files} ${p.cls}${p.t.files === 1 ? '' : 's'}`)
  if (parts.length === 0) return null
  return (
    <span className="text-[11px] text-zinc-500">
      +{num(noise.adds)} &minus;{num(noise.dels)} in {parts.join(', ')} hidden
    </span>
  )
}

function FileRow({
  f,
  selected,
  onSelect,
}: {
  f: PrFileChange
  selected: boolean
  onSelect: (path: string) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onSelect(f.path)}
      aria-current={selected || undefined}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-white/5 ${
        selected ? 'bg-[var(--gt-accent)]/20' : ''
      }`}
    >
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-[2px]"
        style={{ background: CLASS_COLOR[f.cls] }}
      />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-300">{f.path}</span>
      {f.oldPath && (
        <span className="shrink-0 text-[10px] text-zinc-600" title={`Renamed from ${f.oldPath}`}>
          renamed
        </span>
      )}
      {f.binary && <span className="shrink-0 text-[10px] text-zinc-600">binary</span>}
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-600">{f.status}</span>
      <span className="w-24 shrink-0 text-right">
        <Delta adds={f.adds} dels={f.dels} />
      </span>
    </button>
  )
}

export function PrOverviewPanel({
  overview,
  reviewMeta,
}: {
  overview: PrOverview | null | undefined
  /** Risk verdict from the harness review artifact, when one exists. */
  reviewMeta: Review | null
}) {
  const [showNoise, setShowNoise] = useState(false)
  const [selected, setSelected] = useState('')

  const agg = overview ? (showNoise ? overview.raw : overview.filtered) : null
  const visible = useMemo(() => {
    if (!overview) return []
    const list = showNoise ? overview.files : overview.files.filter((f) => !f.noise)
    return [...list].sort((a, b) => churn(b) - churn(a))
  }, [overview, showNoise])

  if (overview === undefined)
    return <div className="p-6 text-[12px] text-zinc-600">Analysing the diff…</div>
  if (!overview || !agg || overview.files.length === 0)
    return (
      <div className="p-6">
        <Empty>No diff to analyse yet — the forge returned nothing for this PR.</Empty>
      </div>
    )

  const typeMax = Math.max(1, ...agg.byFileType.map(churn))
  const sourceFiles = agg.byClass.source.files + agg.byClass.test.files + agg.byClass.docs.files
  const noiseFiles = overview.noise.files

  return (
    <div className="h-full overflow-y-auto">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-[var(--gt-border)] bg-[var(--gt-bg)] px-5 py-3">
        <Delta adds={agg.adds} dels={agg.dels} big />
        <span className="text-[11px] text-zinc-500">
          <span className="tabular-nums text-zinc-300">{sourceFiles}</span> reviewable
          {noiseFiles > 0 && (
            <>
              {' '}
              · <span className="tabular-nums text-zinc-400">{noiseFiles}</span> noise
            </>
          )}
        </span>
        <span className="text-[11px] text-zinc-500">
          tests{' '}
          <span className="tabular-nums text-zinc-300">
            {agg.testRatio === null ? 'none' : pct(agg.testRatio)}
          </span>
        </span>
        {agg.renames > 0 && (
          <span className="text-[11px] text-zinc-500">
            <span className="tabular-nums text-zinc-300">{agg.renames}</span> renamed
          </span>
        )}
        {reviewMeta && reviewMeta.riskTier !== 'unscored' && (
          <Badge
            variant={
              reviewMeta.riskTier === 'high'
                ? 'destructive'
                : reviewMeta.riskTier === 'medium'
                  ? 'warning'
                  : 'success'
            }
          >
            {reviewMeta.riskScore != null
              ? `risk ${reviewMeta.riskScore}/5`
              : `${reviewMeta.riskTier} risk`}
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          <NoiseSummary noise={overview.noise} />
          {noiseFiles > 0 && (
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={() => setShowNoise((v) => !v)}
              aria-pressed={showNoise}
            >
              {showNoise ? <Eye size={11} strokeWidth={2} /> : <EyeOff size={11} strokeWidth={2} />}
              {showNoise ? 'Showing all' : 'Noise hidden'}
            </Button>
          )}
        </div>
      </div>

      {overview.hints.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 border-b border-[var(--gt-border)] px-5 py-2">
          {overview.hints.map((h) => (
            <li key={h} className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
              <TriangleAlert
                size={11}
                strokeWidth={2.25}
                style={{ color: 'var(--gt-yellow)' }}
                aria-hidden
              />
              {h}
            </li>
          ))}
        </ul>
      )}

      <div className="p-5">
        <section className="mb-5">
          <div className="mb-2 flex items-center gap-3">
            <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-zinc-500">
              Change map
            </span>
            <span className="flex flex-wrap items-center gap-2">
              {LEGEND.map((l) => (
                <span
                  key={l.cls}
                  className="inline-flex items-center gap-1 text-[10px] text-zinc-500"
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-[2px]"
                    style={{ background: CLASS_COLOR[l.cls] }}
                  />
                  {l.label}
                </span>
              ))}
            </span>
          </div>
          <div className="overflow-x-auto">
            <ChangeBlockMap files={visible} selected={selected} onSelect={setSelected} />
          </div>
        </section>

        <div className="mb-5 grid gap-5 lg:grid-cols-2">
          <section>
            <Eyebrow>Lines by file type</Eyebrow>
            {agg.byFileType.map((t) => (
              <Bar
                key={t.id}
                label={t.id}
                total={churn(t)}
                max={typeMax}
                adds={t.adds}
                dels={t.dels}
                files={t.files}
              />
            ))}
          </section>
          <section>
            <Eyebrow>Lines by directory</Eyebrow>
            <DirectoryBars agg={agg} />
          </section>
        </div>

        <section>
          <Eyebrow>
            Files ({visible.length}
            {showNoise ? '' : noiseFiles > 0 ? ` of ${overview.files.length}` : ''})
          </Eyebrow>
          <div className="max-h-80 overflow-y-auto rounded-lg border border-[var(--gt-border)] p-1">
            {visible.map((f) => (
              <FileRow
                key={f.path}
                f={f}
                selected={selected === f.path}
                onSelect={(p) => setSelected(p === selected ? '' : p)}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
