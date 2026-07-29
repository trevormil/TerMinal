import { useEffect, useMemo, useState } from 'react'
import {
  FileText,
  Code2,
  Table2,
  Image as ImageIcon,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from 'lucide-react'
import { Markdown } from './Markdown'
import {
  base64ToBytes,
  dataUrl,
  delimiterFor,
  hasSourceToggle,
  hexDump,
  humanSize,
  needsBinaryRead,
  parseDelimited,
  viewerKindFor,
  type ViewerKind,
} from '../../../shared/file-viewers'

// Per-type file viewers for the Files tab. Previously every file went to
// CodeMirror: a .md showed raw markdown, an image failed outright ("binary
// file"), a CSV was a wall of commas. Each viewer here renders the file the way
// you'd actually want to read it, with a source toggle where that makes sense.

const toolbarBtn =
  'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors cursor-pointer'

function Toolbar({
  kind,
  showSource,
  onToggleSource,
  right,
}: {
  kind: ViewerKind
  showSource: boolean
  onToggleSource: () => void
  right?: React.ReactNode
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--gt-border)] px-3 py-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
        {kind}
      </span>
      <div className="flex-1" />
      {right}
      {hasSourceToggle(kind) && (
        <button
          onClick={onToggleSource}
          title={showSource ? 'Show rendered' : 'Show source'}
          className={`${toolbarBtn} ${
            showSource
              ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
              : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
          }`}
        >
          {showSource ? (
            <FileText size={12} strokeWidth={2} />
          ) : (
            <Code2 size={12} strokeWidth={2} />
          )}
          {showSource ? 'Rendered' : 'Source'}
        </button>
      )}
    </div>
  )
}

/** Markdown rendered with the shared renderer, scroll-synced to the source. */
function MarkdownView({ text }: { text: string }) {
  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="mx-auto max-w-3xl">
        <Markdown>{text}</Markdown>
      </div>
    </div>
  )
}

/** Delimited data as a real table. Row 1 is treated as the header. */
const CSV_ROW_PAGE = 500

function CsvView({ text, path }: { text: string; path: string }) {
  const rows = useMemo(() => parseDelimited(text, delimiterFor(path)), [text, path])
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null)
  const [q, setQ] = useState('')
  // A large CSV fully materialized as table cells janks — page the render.
  const [visibleRowCount, setVisibleRowCount] = useState(CSV_ROW_PAGE)
  useEffect(() => {
    setVisibleRowCount(CSV_ROW_PAGE)
  }, [q, sort, path])

  const header = rows[0] || []
  const body = useMemo(() => {
    let out = rows.slice(1)
    const needle = q.trim().toLowerCase()
    if (needle) out = out.filter((r) => r.some((c) => c.toLowerCase().includes(needle)))
    if (sort) {
      const { col, dir } = sort
      // Numeric when both sides parse as numbers, else lexicographic.
      out = [...out].sort((a, b) => {
        const x = a[col] ?? ''
        const y = b[col] ?? ''
        const nx = Number(x)
        const ny = Number(y)
        const both = x !== '' && y !== '' && !Number.isNaN(nx) && !Number.isNaN(ny)
        return (both ? nx - ny : x.localeCompare(y)) * dir
      })
    }
    return out
  }, [rows, sort, q])

  if (!rows.length) return <div className="p-6 text-[12px] text-zinc-600">Empty file.</div>

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 py-1.5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter rows…"
          className="w-48 rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60"
        />
        <span className="text-[10.5px] tabular-nums text-zinc-600">
          {body.length} / {rows.length - 1} rows · {header.length} cols
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-max border-collapse text-[11.5px]">
          <thead className="sticky top-0 bg-[var(--gt-panel)]">
            <tr>
              <th className="border border-[var(--gt-border)] px-2 py-1 text-right text-[10px] text-zinc-600">
                #
              </th>
              {header.map((h, i) => (
                <th
                  key={i}
                  onClick={() =>
                    setSort((s) =>
                      s?.col === i ? { col: i, dir: s.dir === 1 ? -1 : 1 } : { col: i, dir: 1 },
                    )
                  }
                  className="cursor-pointer border border-[var(--gt-border)] px-2 py-1 text-left font-semibold text-zinc-200 hover:bg-white/5"
                  title="Sort"
                >
                  {h || <span className="text-zinc-600">col {i + 1}</span>}
                  {sort?.col === i && (
                    <span className="ml-1 text-[var(--gt-accent-2)]">
                      {sort.dir === 1 ? '▲' : '▼'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.slice(0, visibleRowCount).map((r, ri) => (
              <tr key={ri} className="hover:bg-white/5">
                <td className="border border-[var(--gt-border)] px-2 py-0.5 text-right text-[10px] tabular-nums text-zinc-700">
                  {ri + 1}
                </td>
                {header.map((_, ci) => (
                  <td
                    key={ci}
                    className="whitespace-pre border border-[var(--gt-border)] px-2 py-0.5 text-zinc-300"
                  >
                    {r[ci] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {body.length > visibleRowCount && (
          <button
            onClick={() => setVisibleRowCount((v) => v + CSV_ROW_PAGE)}
            className="w-full px-2 py-1.5 text-center text-[11px] text-[var(--gt-accent-2)] hover:bg-white/5"
          >
            Show {Math.min(body.length - visibleRowCount, CSV_ROW_PAGE)} more rows (
            {body.length - visibleRowCount} hidden)
          </button>
        )}
      </div>
    </div>
  )
}

function ImageView({ src, size }: { src: string; size: number }) {
  const [zoom, setZoom] = useState(1)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-[10.5px] text-zinc-600">
        <ImageIcon size={12} strokeWidth={2} />
        {dims && (
          <span className="tabular-nums">
            {dims.w} × {dims.h}
          </span>
        )}
        <span>· {humanSize(size)}</span>
        <div className="flex-1" />
        <button
          onClick={() => setZoom((z) => Math.max(0.1, z / 1.25))}
          className={toolbarBtn}
          title="Zoom out"
        >
          <ZoomOut size={12} strokeWidth={2} />
        </button>
        <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => setZoom((z) => Math.min(16, z * 1.25))}
          className={toolbarBtn}
          title="Zoom in"
        >
          <ZoomIn size={12} strokeWidth={2} />
        </button>
        <button onClick={() => setZoom(1)} className={toolbarBtn} title="Reset zoom">
          <Maximize2 size={12} strokeWidth={2} />
        </button>
      </div>
      {/* Checkerboard so transparent PNGs are readable. */}
      <div
        className="min-h-0 flex-1 overflow-auto p-4"
        style={{
          backgroundImage:
            'linear-gradient(45deg,#1a1a1a 25%,transparent 25%),linear-gradient(-45deg,#1a1a1a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#1a1a1a 75%),linear-gradient(-45deg,transparent 75%,#1a1a1a 75%)',
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0,0 8px,8px -8px,-8px 0px',
        }}
      >
        <img
          src={src}
          onLoad={(e) =>
            setDims({
              w: (e.target as HTMLImageElement).naturalWidth,
              h: (e.target as HTMLImageElement).naturalHeight,
            })
          }
          style={{
            width: dims ? dims.w * zoom : undefined,
            imageRendering: zoom > 2 ? 'pixelated' : 'auto',
          }}
          className="max-w-none"
          alt=""
        />
      </div>
    </div>
  )
}

function HexView({ base64, size }: { base64: string; size: number }) {
  const { lines, shown } = useMemo(() => {
    const bytes = base64ToBytes(base64)
    const l = hexDump(bytes)
    return { lines: l, shown: Math.min(bytes.length, l.length * 16) }
  }, [base64])
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-3 py-1.5 text-[10.5px] text-zinc-600">
        Binary · {humanSize(size)}
        {shown < size && (
          <span className="text-[var(--gt-yellow)]"> · showing first {humanSize(shown)}</span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3 font-mono text-[11px] leading-[1.45]">
        {lines.map((l) => (
          <div key={l.offset} className="whitespace-pre">
            <span className="text-zinc-700">{l.offset}</span>{' '}
            <span className="text-zinc-400">{l.hex}</span>{' '}
            <span className="text-[var(--gt-accent-2)]">{l.ascii}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Renders `path` with the right viewer. Returns null for kinds the caller
 * should hand to CodeMirror instead ('text', or any kind showing its source).
 */
export function FileViewer({
  path,
  text,
  showSource,
  onWantsSource,
}: {
  path: string
  /** utf8 content, already loaded by the Files tab (empty for binary kinds). */
  text: string
  /**
   * Rendered-vs-source is CONTROLLED by the caller. It must not also live here:
   * the caller swaps which FileViewer instance is mounted when it flips, so a
   * local copy is destroyed and re-initialised on every toggle — the flag
   * snapped straight back to false and the Source button appeared dead.
   */
  showSource: boolean
  /** Called with the flag the user asked for; the caller renders its editor
   *  when true, keeping edit/save in one place. */
  onWantsSource: (source: boolean) => void
}) {
  const kind = viewerKindFor(path)
  const [bin, setBin] = useState<{ base64: string; size: number; reason?: string } | null>(null)

  // Binary kinds need the raw bytes; text kinds already have their content.
  useEffect(() => {
    let alive = true
    setBin(null)
    if (!needsBinaryRead(kind)) return
    window.gt.files.readBinary(path).then((r) => {
      if (alive) setBin({ base64: r.base64, size: r.size, reason: r.ok ? undefined : r.reason })
    })
    return () => {
      alive = false
    }
  }, [path, kind])

  const toggle = () => onWantsSource(!showSource)

  if (showSource) {
    // The caller renders CodeMirror; we keep the toolbar so it can be toggled back.
    return <Toolbar kind={kind} showSource onToggleSource={toggle} />
  }

  const body = () => {
    if (needsBinaryRead(kind)) {
      if (!bin) return <div className="p-6 text-[12px] text-zinc-600">Loading…</div>
      if (bin.reason) return <div className="p-6 text-[12px] text-zinc-600">{bin.reason}</div>
      if (kind === 'image') return <ImageView src={dataUrl(path, bin.base64)} size={bin.size} />
      if (kind === 'pdf')
        return (
          <iframe title={path} src={dataUrl(path, bin.base64)} className="h-full w-full border-0" />
        )
      return <HexView base64={bin.base64} size={bin.size} />
    }
    if (kind === 'markdown') return <MarkdownView text={text} />
    if (kind === 'csv') return <CsvView text={text} path={path} />
    if (kind === 'svg')
      return (
        <ImageView
          src={`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`}
          size={text.length}
        />
      )
    return null
  }

  const rendered = body()
  if (!rendered) return null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar kind={kind} showSource={false} onToggleSource={toggle} />
      <div className="min-h-0 flex-1">{rendered}</div>
    </div>
  )
}

/** True when this path renders through FileViewer rather than the editor. */
export function hasViewer(path: string): boolean {
  return viewerKindFor(path) !== 'text' && viewerKindFor(path) !== 'json'
}
