import type { ReactNode } from 'react'

export function SkillHint({ children }: { children: ReactNode }) {
  return (
    <div className="break-words border-l border-[var(--gt-border)] py-0.5 pl-2.5 text-[11px] leading-snug text-zinc-500">
      {children}
    </div>
  )
}
