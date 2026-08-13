import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { FOCUSABLE_SELECTOR, iconButtonClasses, join, nextFocusIndex } from '../lib/controls'

// The one modal. Before this file the renderer carried 17 separate
// `fixed inset-0` overlays, each re-deriving backdrop-click, Escape, focus and
// scroll behaviour — and each getting a different subset of it right. That is
// an accessibility liability, not a style problem: a dialog that never moves
// focus leaves a keyboard user tabbing through the page behind the backdrop.
//
// Everything below is the union of what those overlays did correctly, in one
// place: portal, backdrop click, Escape, focus move-in + restore-on-close, a
// Tab trap, aria-modal/labelledby, and a body scroll lock that survives nesting.

/** Nesting depth, so an inner modal closing does not unlock the page. */
let scrollLocks = 0

function lockScroll(): () => void {
  const body = document.body
  if (scrollLocks === 0) {
    body.dataset.gtPrevOverflow = body.style.overflow
    body.style.overflow = 'hidden'
  }
  scrollLocks += 1
  return () => {
    scrollLocks = Math.max(0, scrollLocks - 1)
    if (scrollLocks === 0) {
      body.style.overflow = body.dataset.gtPrevOverflow ?? ''
      delete body.dataset.gtPrevOverflow
    }
  }
}

export type ModalProps = {
  onClose: () => void
  /** Visible heading. Also names the dialog via aria-labelledby. */
  title?: ReactNode
  /** Accessible name when there is no visible `title` (or it is not text). */
  label?: string
  /** Extra controls on the header row, left of the close button. */
  actions?: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** Tailwind width classes for the dialog. */
  width?: string
  /** Vertical placement. Palettes sit high; content dialogs centre. */
  align?: 'center' | 'top'
  /** Stacking context. Matches the ad-hoc z-indices the old overlays used. */
  z?: string
  className?: string
  /** Set false for a dialog that must be dismissed with an explicit control. */
  closeOnBackdrop?: boolean
}

/**
 * The dialog surface without the portal or the effects — the part that can be
 * rendered by `renderToStaticMarkup`, which is how the aria contract is tested
 * in a suite that has no DOM.
 */
export function ModalFrame({
  title,
  label,
  actions,
  children,
  footer,
  titleId,
  width = 'w-[640px] max-w-[94vw]',
  className = '',
  onClose,
  dialogRef,
  onKeyDown,
}: Pick<ModalProps, 'title' | 'label' | 'actions' | 'children' | 'footer' | 'width' | 'className'> & {
  titleId: string
  onClose: () => void
  dialogRef?: React.RefObject<HTMLDivElement | null>
  onKeyDown?: (e: React.KeyboardEvent) => void
}) {
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      {...(title ? { 'aria-labelledby': titleId } : { 'aria-label': label ?? 'Dialog' })}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      // Portals bubble through the REACT tree, not the DOM tree — without this a
      // click inside the dialog reaches the backdrop's onClick and closes it.
      onClick={(e) => e.stopPropagation()}
      className={join(
        'flex max-h-[85vh] flex-col overflow-hidden rounded-xl border border-[var(--gt-border)]',
        'bg-[var(--gt-bg)] shadow-2xl outline-none',
        width,
        className,
      )}
    >
      {(title || actions) && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-3 py-2">
          {title && (
            <span id={titleId} className="min-w-0 flex-1 truncate text-[12px] font-semibold text-zinc-100">
              {title}
            </span>
          )}
          {actions}
          {/* Not the shared IconButton: ui.tsx re-exports Modal, and importing
              back the other way would close an import cycle. */}
          <button
            type="button"
            aria-label="Close"
            title="Close (Esc)"
            onClick={onClose}
            className={iconButtonClasses('ghost', 'sm')}
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer && (
        <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-[var(--gt-border)] px-3 py-2">
          {footer}
        </div>
      )}
    </div>
  )
}

export function Modal({
  onClose,
  align = 'center',
  z = 'z-50',
  closeOnBackdrop = true,
  ...frame
}: ModalProps) {
  const dialog = useRef<HTMLDivElement>(null)
  const titleId = useId()

  // Escape closes. Capture phase so a modal cannot be beaten to the key by a
  // window-level handler belonging to the surface underneath it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Focus in on open, back out on close. Without the restore, dismissing a
  // dialog drops focus on <body> and the next Tab restarts from the top.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const first = dialog.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    ;(first ?? dialog.current)?.focus()
    return () => prev?.focus?.()
  }, [])

  useEffect(() => lockScroll(), [])

  // Tab trap. Rebuilt on every keypress rather than cached: a dialog's
  // focusables change as its content loads, and a stale list traps into a node
  // that is no longer there.
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !dialog.current) return
    const items = Array.from(dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    const next = nextFocusIndex(
      items.length,
      items.indexOf(document.activeElement as HTMLElement),
      e.shiftKey,
    )
    if (next === null) return
    e.preventDefault()
    items[next].focus()
  }, [])

  return createPortal(
    <div
      className={join(
        'fixed inset-0 flex justify-center bg-black/70 p-4 backdrop-blur-sm',
        align === 'top' ? 'items-start pt-[10vh]' : 'items-center',
        z,
      )}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <ModalFrame {...frame} titleId={titleId} onClose={onClose} dialogRef={dialog} onKeyDown={onKeyDown} />
    </div>,
    document.body,
  )
}
