import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// The shadcn `cn` helper: clsx for conditional classes, tailwind-merge so a
// later utility evicts an earlier one that sets the same property (which
// Tailwind otherwise resolves by stylesheet order, not class-list order).
// This supersedes `lib/controls.ts` `mergeClasses` for the new shadcn-based
// components in `components/ui/`; the legacy `components/ui.tsx` primitives
// keep using `mergeClasses` until their call sites are migrated.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
