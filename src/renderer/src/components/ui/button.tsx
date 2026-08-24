import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// TerMinal's button, on shadcn's cva skeleton. The variants keep the brand's
// four clusters (see design-system.md §7.1) under shadcn's conventional names:
//   default     → primary   (accent-tinted confirm)
//   secondary   → subtle    (bordered)
//   ghost       → ghost     (no chrome until hover)
//   destructive → danger    (red)
// `outline`/`link` are the shadcn-standard extras. The primary fill is a tint
// (`/10` → `/20`), not a solid — depth from the border, per §2.1/§2.2.

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-3.5',
  {
    variants: {
      variant: {
        default:
          'border border-primary/40 bg-primary/10 font-semibold text-[var(--gt-accent-light)] shadow-sm shadow-primary/20 hover:bg-primary/20',
        destructive:
          'border border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20',
        outline:
          'border border-input text-foreground/80 hover:border-primary/60 hover:bg-muted hover:text-foreground',
        secondary:
          'border border-border text-[var(--gt-text-soft)] hover:border-primary/60 hover:bg-muted',
        ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-6 px-1.5 text-[10.5px]',
        sm: 'h-7 px-2 text-[11px]',
        default: 'h-8 px-2.5 text-[12px]',
        lg: 'h-10 px-4 text-sm',
        icon: 'size-7',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
