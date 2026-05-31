import type { ReactNode } from 'react'

export function SkillHint({ children }: { children: ReactNode }) {
  return (
    <div className="break-words rounded-md border border-[var(--gt-border)] bg-black/20 px-2.5 py-1.5 text-[10.5px] leading-relaxed text-zinc-500">
      {children}
    </div>
  )
}
