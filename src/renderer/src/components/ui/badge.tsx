import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// Status tag. Tones map to the brand's semantic hues; `secondary`/`outline`
// are the neutral shadcn shapes. `text-[var(--gt-accent-light)]` on the accent
// tone keeps the lighter-violet label the brand already uses on violet tints.

const badgeVariants = cva(
  'inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors focus:outline-none [&_svg]:pointer-events-none [&_svg]:size-2.5',
  {
    variants: {
      variant: {
        default: 'border-primary/30 bg-primary/10 text-[var(--gt-accent-light)]',
        secondary: 'border-border bg-muted text-muted-foreground',
        outline: 'border-border text-foreground/80',
        destructive: 'border-destructive/25 bg-destructive/10 text-destructive',
        success: 'border-[var(--gt-green)]/25 bg-[var(--gt-green)]/10 text-[var(--gt-green)]',
        warning: 'border-[var(--gt-yellow)]/25 bg-[var(--gt-yellow)]/10 text-[var(--gt-yellow)]',
        info: 'border-[var(--gt-blue)]/25 bg-[var(--gt-blue)]/10 text-[var(--gt-blue)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span'
  return (
    <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
