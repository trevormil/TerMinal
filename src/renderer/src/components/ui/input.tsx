import * as React from 'react'
import { cn } from '@/lib/utils'

// Text field. The brand field is a dark translucent fill (`--gt-input`) with a
// `--gt-border` hairline and an accent focus ring; `bg-muted` here maps to the
// neutral hover surface so the field reads as an input, not a solid panel.

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-7 w-full rounded-md border border-input bg-[var(--gt-input)] px-2 py-1 text-[12px] text-foreground transition-colors placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-default disabled:opacity-40',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
