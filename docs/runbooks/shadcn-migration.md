# shadcn/ui migration runbook

How to migrate a TerMinal surface from the legacy primitive library to the
shadcn/ui component library. This is the contract every migration subagent
follows. Read [`../brand-kit.md`](../brand-kit.md) first — the token map and
variant table live there.

## Goal

Replace hand-rolled controls and the legacy `components/ui.tsx` primitives with
the shadcn components in `components/ui/`, **without changing behaviour**:
poll intervals, IPC calls, `data-*` attributes (`data-tab-id`,
`data-tab-pane` — `docs/ux-testing.md` depends on them), and accessibility
(every icon-only button keeps an `aria-label`). A restyle must not change a
keyboard or screen-reader path.

## The reference

`src/renderer/src/plugins/context/index.tsx` and
`src/renderer/src/plugins/now-doing/index.tsx` are the canonical migrations.
Match their shape: `TitledCard` for the card, `Gauge`/`Big`/`Empty` for the
display atoms, semantic tokens for text.

## Component map

| Legacy (`components/ui`) | shadcn (`components/ui/*`) |
| --- | --- |
| `Card icon title right` | `titled-card` `TitledCard` (same props) |
| `Gauge pct color` | `gauge` `Gauge` (same props) |
| `Big value sub` | `display` `Big` |
| `Stat label value` | `display` `Stat` |
| `Row label value` | `display` `Row` |
| `Empty` | `display` `Empty` |
| `Badge tone` | `badge` `Badge variant` (`ok→success`, `warn→warning`, `bad/mute→destructive/secondary`, `red→destructive`, `accent→default`) |
| `Button variant="primary\|subtle\|ghost\|danger"` | `button` `Button variant="default\|secondary\|ghost\|destructive"` |
| `Button size="xs\|sm\|md"` | `Button size="xs\|sm\|default"` |
| `IconButton` | `Button variant="ghost" size="icon"` + `aria-label` |
| `Input` | `input` `Input` |
| `Select` (native) | `select` `Select` (Radix) — only where a styled menu is warranted; otherwise `DropdownMenu` or keep native |
| `Modal` | `dialog` `Dialog` (Radix owns focus/backdrop/Escape) |
| `Toolbar` | a `div` with `flex items-center gap-1.5` (or keep if bordered) |

## Hard rules (enforced by CI)

- **No raw colours** — no `bg-zinc-*` / `bg-slate-*` / `bg-neutral-*` /
  `bg-gray-*` / `bg-[#hex]`. Use semantic tokens (`bg-muted`,
  `text-muted-foreground`, `bg-primary`, …) or existing `--gt-*` tokens.
- **No emoji** in renderer source.
- **Two tint steps** — accent/semantic tints at `/10` and `/20` only.
- **Depth from borders, not fills** — a card inside a panel never re-fills
  `--gt-panel`.
- **Capitalization** — user-facing labels start with a capital; data (engine
  ids, paths, shas, model slugs, commands) is untouched.

## Verification (run before finishing)

```bash
bunx tsc --noEmit
bun test src/renderer/src/design-system.test.ts src/shared/token-parity.test.ts
```

Both must pass. Do **not** `git add`/`git commit`/`git push` — the orchestrator
integrates. Do not touch files outside your assigned partition.
