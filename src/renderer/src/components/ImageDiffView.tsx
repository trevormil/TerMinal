import { useState } from 'react'
import { Columns2, Layers, MoveHorizontal } from 'lucide-react'
import { dataUrl } from '../../../shared/file-viewers'

// Image diff (ticket 0048): HEAD vs working tree for image files, with the
// two classic comparison modes on top of plain side-by-side:
//   - swipe: both images stacked, a draggable divider clips the new one
//   - onion-skin: the new image fades over the old via an opacity slider
// An image that exists on only one side (added / deleted) degrades to a
// single labeled pane — swiping against nothing is meaningless.

type Mode = 'side' | 'swipe' | 'onion'

export function ImageDiffView({
  path,
  oldBase64,
  newBase64,
}: {
  path: string
  /** '' when the file didn't exist at HEAD (added). */
  oldBase64: string
  /** '' when the file is gone from the working tree (deleted). */
  newBase64: string
}) {
  const [mode, setMode] = useState<Mode>('swipe')
  const [pos, setPos] = useState(50)
  const oldSrc = oldBase64 ? dataUrl(path, oldBase64) : ''
  const newSrc = newBase64 ? dataUrl(path, newBase64) : ''
  const both = !!oldSrc && !!newSrc

  const btn = (on: boolean) =>
    `inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors ${
      on
        ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
        : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
    }`

  if (!both) {
    const src = newSrc || oldSrc
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-3 py-1.5 text-[11px] text-zinc-500">
          {newSrc ? 'Added — no version at HEAD' : 'Deleted — only the HEAD version exists'}
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[var(--gt-code-bg)] p-4">
          {src ? (
            <img src={src} className="max-h-full max-w-full object-contain" alt={path} />
          ) : (
            <span className="text-[12px] text-zinc-600">Nothing to show.</span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--gt-border)] px-3 py-1.5">
        <button
          onClick={() => setMode('side')}
          className={btn(mode === 'side')}
          title="Side by side"
        >
          <Columns2 size={12} strokeWidth={2} />
          Side
        </button>
        <button onClick={() => setMode('swipe')} className={btn(mode === 'swipe')} title="Swipe">
          <MoveHorizontal size={12} strokeWidth={2} />
          Swipe
        </button>
        <button
          onClick={() => setMode('onion')}
          className={btn(mode === 'onion')}
          title="Onion skin"
        >
          <Layers size={12} strokeWidth={2} />
          Onion
        </button>
        {mode !== 'side' && (
          <input
            type="range"
            min={0}
            max={100}
            value={pos}
            onChange={(e) => setPos(Number(e.target.value))}
            className="ml-3 w-40 accent-[var(--gt-accent)]"
            title={mode === 'swipe' ? 'Reveal' : 'Opacity'}
          />
        )}
        <div className="flex-1" />
        <span className="text-[10px] text-zinc-700">HEAD vs working tree</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-[var(--gt-code-bg)] p-4">
        {mode === 'side' ? (
          <div className="flex h-full items-center justify-center gap-4">
            {[
              { src: oldSrc, label: 'HEAD' },
              { src: newSrc, label: 'Working' },
            ].map(({ src, label }) => (
              <figure key={label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <img src={src} className="max-h-[70vh] max-w-full object-contain" alt={label} />
                <figcaption className="text-[10.5px] text-zinc-600">{label}</figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className="relative mx-auto flex h-full items-center justify-center">
            <div className="relative inline-block">
              <img
                src={oldSrc}
                className="block max-h-[75vh] max-w-full object-contain"
                alt="HEAD"
              />
              <img
                src={newSrc}
                alt="Working"
                className="absolute inset-0 h-full w-full object-contain"
                style={
                  mode === 'swipe'
                    ? { clipPath: `inset(0 ${100 - pos}% 0 0)` }
                    : { opacity: pos / 100 }
                }
              />
              {mode === 'swipe' && (
                <div
                  className="pointer-events-none absolute inset-y-0 w-px bg-[var(--gt-accent)]"
                  style={{ left: `${pos}%` }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
