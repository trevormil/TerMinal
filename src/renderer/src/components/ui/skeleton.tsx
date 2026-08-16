import { cn } from '@/lib/utils'

// Loading placeholder. `--muted` → `--gt-surface-hover`, a neutral tint one
// step off the background, so a skeleton reads as "content still loading"
// without introducing a raw grey (design-system.md §2.3).

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  )
}

export { Skeleton }
