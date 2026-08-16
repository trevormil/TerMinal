import * as React from 'react'
import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-16 w-full rounded-md border border-input bg-[var(--gt-input)] px-2 py-1.5 text-[12px] text-foreground transition-colors placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40 disabled:cursor-default disabled:opacity-40',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
