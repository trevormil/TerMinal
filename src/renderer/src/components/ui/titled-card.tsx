import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// The brand's titled block: a bordered card whose header is a small icon, an
// uppercase eyebrow, and an optional right slot, over a body. This is the
// cockpit card and the panel card — the single pattern the legacy
// `components/ui.tsx` `Card` encoded. Built on the shadcn Card so it inherits
// the token system, and the eyebrow styling lives in exactly one place.

function TitledCard({
  icon: Icon,
  title,
  right,
  className,
  children,
}: {
  icon: LucideIcon
  title: string
  right?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <Card className={cn('mb-1.5', className)}>
      <CardHeader className="flex flex-row items-center gap-1.5 space-y-0 px-2.5 py-2">
        <Icon className="size-3 shrink-0 text-muted-foreground" strokeWidth={2.25} />
        <CardTitle className="flex-1 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {title}
        </CardTitle>
        {right}
      </CardHeader>
      <CardContent className="px-2.5 pb-2 pt-0">{children}</CardContent>
    </Card>
  )
}

export { TitledCard }
