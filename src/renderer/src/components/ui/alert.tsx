import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// Callout banner. Default carries the accent tint; destructive uses the brand
// red at the two allowed steps (/10 fill, /25 border).

const alertVariants = cva(
  'relative w-full rounded-lg border px-3 py-2 text-[12px] [&>svg]:absolute [&>svg]:left-2.5 [&>svg]:top-2.5 [&>svg]:size-3.5 [&>svg]:text-foreground',
  {
    variants: {
      variant: {
        default: 'border-primary/25 bg-primary/10',
        destructive: 'border-destructive/25 bg-destructive/10 text-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('mb-0.5 font-semibold leading-none', className)}
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('text-muted-foreground', className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription }
