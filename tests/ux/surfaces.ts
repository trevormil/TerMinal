// The surfaces tier 2 screenshots, and the design language it judges them
// against. Shared with tier 1 so the two tiers cannot drift apart on what
// counts as a "key surface".

export type Surface = {
  /** Tab id to open. */
  tab: string
  /** File-name stem for the screenshot. */
  name: string
  /** What a reviewer should be looking at here. */
  intent: string
}

export const SURFACES: Surface[] = [
  {
    tab: 'terminal',
    name: 'terminal',
    intent: 'The default view: terminal plus the cockpit rail.',
  },
  {
    tab: 'tickets',
    name: 'tickets',
    intent: 'Ticket list plus the detail pane and its tab strip.',
  },
  { tab: 'mrs', name: 'mrs', intent: 'PR/MR list — mostly an empty/unauthenticated state here.' },
  { tab: 'agents', name: 'agents', intent: 'Agent list and its detail tab strip.' },
  { tab: 'runs', name: 'runs', intent: 'Run history rows and their header.' },
  { tab: 'schedules', name: 'schedules', intent: 'Scheduled agents, empty in a fresh repo.' },
  { tab: 'ci', name: 'ci', intent: 'CI status for a repo with no pipelines.' },
  { tab: 'files', name: 'files', intent: 'File tree and viewer.' },
  { tab: 'reports', name: 'reports', intent: 'Report browser, empty in a fresh repo.' },
  { tab: 'monitoring', name: 'monitoring', intent: 'Checks dashboard.' },
]

// The rubric. Deliberately anchored in THIS app's own patterns, so the model
// flags inconsistency rather than generic ugliness — "these two tab strips look
// different" is actionable, "this could be prettier" is not.
export const DESIGN_LANGUAGE = `
TerMinal's own conventions, which these screenshots should be consistent with:

- **Tab strips.** \`src/renderer/src/components/DetailTabs.tsx\` is the canonical
  detail tab strip: a bottom-bordered row of small text buttons, the active one
  tinted, counts rendered as a muted "· N" suffix. Agents and Tickets both use
  it. Any surface that rolls its own tab strip is an inconsistency.
- **Chips/badges** come from \`components/ui\` \`Badge\` with a small tone set
  (green / yellow / red / blue / mute). Two chips meaning the same kind of thing
  should have the same tone and the same shape.
- **Density.** This is a dense, dark, monospace-leaning developer tool. Tight is
  correct; cramped is not. The line between them is whether text truncates or
  controls collide.
- **Empty states** must read as "nothing here", never as "still loading". An
  empty state that is a bare dash, a zero, or blank space is a defect.
`.trim()

export const RUBRIC = `
For EACH screenshot, judge only what a human can see. Report concrete, located
findings — never general praise, never speculation about code.

Look for:
1. **Truncation.** Text cut off mid-word, an ellipsis where the content matters,
   a command or path you would have to scroll sideways to finish reading. A
   command a user must drag to read is a command they approve unread.
2. **Cramped controls.** Inputs too narrow to type a real value into, buttons
   colliding, a placeholder longer than its field.
3. **Dead space.** Large empty regions with no purpose; a header row or a card
   that carries no information; padding that reads as a rendering bug.
4. **Inconsistency** against the design language above — mismatched tab strips,
   two different treatments of the same kind of chip, uneven spacing between
   sibling sections.
5. **Ambiguous empty states.** Does this read as "there is nothing here" or as
   "this is still loading / broken"?
6. **Hierarchy.** Is the most important thing on the screen the most prominent?

Output STRICT markdown in exactly this shape and nothing else:

## <surface name>
- **[high|medium|low]** <what is wrong> — <where on the screen> — <what to do>

Use "- none" under a surface with no findings. Severity is about how much it
hurts a user, not how easy it is to fix.
`.trim()
