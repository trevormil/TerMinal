// Class vocabulary for the interactive primitives in `components/ui.tsx`.
//
// Nothing here is invented. Every value was read off the renderer as it already
// existed — the survey behind it counted ~600 hand-written `<button>`, ~122
// `<input>` and ~38 `<select>` elements and ranked their className clusters:
//
//   hover:bg-white/5 ............ 125  -> ghost
//   bg-[var(--gt-accent)]/10 .....  38  -> primary resting fill
//   bg-[var(--gt-accent)]/20 .....  29  -> primary hover  (and `active`)
//   bg-black/30 ..................  74  -> field fill
//   focus:border-[var(--gt-accent)]/60 .. 61  -> field focus ring
//   disabled:opacity-40|50 .......  57  -> disabled
//   bg-[var(--gt-red)]/10 ........  13  -> danger
//
// So a migrated call site should be pixel-identical: the primitives codify the
// majority spelling rather than proposing a new one. Tints stay on the two
// steps design-system.md §2.2 allows (/10, /20) — a third fails the build.
//
// Pure strings, no React: this is the half that `bun test` can check without a
// DOM (see controls.test.ts).

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'subtle'
export type ControlSize = 'xs' | 'sm' | 'md'

/** Shared by every button-shaped control. */
const BUTTON_BASE =
  'inline-flex shrink-0 items-center justify-center gap-1 rounded-md transition-colors ' +
  'disabled:cursor-default disabled:opacity-40'

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  // The confirm action. Tinted, not solid: the solid `bg-[var(--gt-accent)]`
  // spelling exists (24 uses) but is concentrated in onboarding-scale hero
  // buttons, where `size="md"` plus a local className still reaches it.
  primary:
    'border border-[var(--gt-accent)]/40 bg-[var(--gt-accent)]/10 font-semibold ' +
    'text-[var(--gt-accent-light)] hover:bg-[var(--gt-accent)]/20',
  // The bordered secondary. Depth from the border, per §2.1.
  subtle:
    'border border-[var(--gt-border)] text-zinc-300 hover:border-[var(--gt-accent)]/60 ' +
    'hover:bg-white/5',
  // The most common button in the app: no chrome until you point at it.
  ghost: 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200',
  danger:
    'border border-[var(--gt-red)]/50 bg-[var(--gt-red)]/10 text-[var(--gt-red)] ' +
    'hover:bg-[var(--gt-red)]/20',
}

const BUTTON_SIZE: Record<ControlSize, string> = {
  xs: 'px-1.5 py-0.5 text-[10.5px]',
  sm: 'px-2 py-1 text-[11px]',
  md: 'px-2.5 py-1.5 text-[12px]',
}

/** Square-ish padding for a control whose whole content is one icon. */
const ICON_SIZE: Record<ControlSize, string> = {
  xs: 'p-0.5',
  sm: 'p-1',
  md: 'p-1.5',
}

export function buttonClasses(
  variant: ButtonVariant = 'subtle',
  size: ControlSize = 'sm',
  className = '',
): string {
  return join(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)
}

export function iconButtonClasses(
  variant: ButtonVariant = 'ghost',
  size: ControlSize = 'sm',
  className = '',
): string {
  return join(BUTTON_BASE, BUTTON_VARIANT[variant], ICON_SIZE[size], className)
}

const FIELD_BASE =
  'rounded-md border border-[var(--gt-border)] bg-black/30 text-zinc-200 outline-none ' +
  'placeholder:text-zinc-600 focus:border-[var(--gt-accent)]/60 disabled:opacity-40'

const FIELD_SIZE: Record<ControlSize, string> = {
  xs: 'px-1.5 py-0.5 text-[10.5px]',
  sm: 'px-2 py-1 text-[11px]',
  md: 'px-2.5 py-1.5 text-[12px]',
}

export function inputClasses(size: ControlSize = 'sm', className = ''): string {
  return join(FIELD_BASE, FIELD_SIZE[size], className)
}

/** A select is a field that also has to hide the platform chevron affordance. */
export function selectClasses(size: ControlSize = 'sm', className = ''): string {
  return join(FIELD_BASE, FIELD_SIZE[size], 'cursor-pointer', className)
}

export function join(...parts: (string | false | null | undefined)[]): string {
  return parts
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// Focus trap arithmetic
// ---------------------------------------------------------------------------

/**
 * Everything the browser will land Tab on. Deliberately excludes
 * `[tabindex="-1"]` (the dialog shell itself gets one so it can be focused
 * programmatically without joining the tab ring).
 */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Where Tab should go next inside a trap of `count` focusable elements.
 *
 * `current` is the index of the focused element, or -1 when focus is on the
 * dialog shell (or has escaped entirely). Returns null when there is nothing to
 * focus, in which case the caller leaves focus on the shell.
 */
export function nextFocusIndex(count: number, current: number, backwards: boolean): number | null {
  if (count <= 0) return null
  if (current < 0) return backwards ? count - 1 : 0
  return backwards ? (current - 1 + count) % count : (current + 1) % count
}
