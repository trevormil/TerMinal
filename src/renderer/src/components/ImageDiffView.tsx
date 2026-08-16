import { useState } from 'react'
import { Columns2, Layers, MoveHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
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

  const modeBtn = (m: Mode, Icon: typeof Columns2, label: string, title: string) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => setMode(m)}
      className={mode === m ? 'bg-primary/20 text-foreground' : 'text-muted-foreground'}
      title={title}
      aria-pressed={mode === m}
    >
      <Icon size={12} strokeWidth={2} />
      {label}
    </Button>
  )

  if (!both) {
    const src = newSrc || oldSrc
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          {newSrc ? 'Added — no version at HEAD' : 'Deleted — only the HEAD version exists'}
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[var(--gt-code-bg)] p-4">
          {src ? (
            <img src={src} className="max-h-full max-w-full object-contain" alt={path} />
          ) : (
            <span className="text-[12px] text-muted-foreground">Nothing to show.</span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-1.5">
        {modeBtn('side', Columns2, 'Side', 'Side by side')}
        {modeBtn('swipe', MoveHorizontal, 'Swipe', 'Swipe')}
        {modeBtn('onion', Layers, 'Onion', 'Onion skin')}
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
        <span className="text-[10px] text-muted-foreground">HEAD vs working tree</span>
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
                <figcaption className="text-[10.5px] text-muted-foreground">{label}</figcaption>
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
