# TerMinal brand kit

The single source of truth for TerMinal's look, shared by both surfaces:

- **Electron renderer** — implemented as a shadcn/ui component library in
  `src/renderer/src/components/ui/`, driven by Tailwind v4 (`@tailwindcss/vite`).
- **iOS** (`ios/TerMinalRemote/`) — native SwiftUI, porting these same tokens
  and component shapes (see `Design/Theme.swift`).

The *principles* — density, two surfaces, tint steps, no raw colours, no emoji,
capitalization — live in [`design-system.md`](./design-system.md) and are
enforced by `src/renderer/src/design-system.test.ts` and
`src/shared/token-parity.test.ts`. This document adds the *token and component
layer* on top and must not contradict those rules.

---

## 1. Colour

One palette, defined once as the `--gt-*` tokens in `src/renderer/src/index.css`
(hex), the runtime theme layer (`src/renderer/src/lib/themes.ts`) swaps them for
dark/light and the three themes. `token-parity.test.ts` keeps the hex values
locked to `ios/.../Design/Theme.swift`.

shadcn components reference **semantic** names (`bg-primary`, `text-foreground`,
`border-input`), not `--gt-*` directly. Each semantic token is an **alias** of a
brand token, declared in `index.css` and exposed via `@theme inline`:

| Semantic (shadcn) | Brand token | Notes |
| --- | --- | --- |
| `--background` | `--gt-bg` | the window |
| `--foreground` | `--gt-text` | primary text |
| `--card` | `--gt-panel` | a lifted surface |
| `--popover` | `--gt-panel` | menus/dialogs/tooltips |
| `--primary` | `--gt-accent` | violet — the primary action hue |
| `--primary-foreground` | `--gt-inverse` | text on primary |
| `--secondary` | `--gt-panel-2` | a soft secondary fill |
| `--secondary-foreground` | `--gt-text` | |
| `--muted` | `--gt-surface-hover` | neutral subtle surface (skeleton, hover fill) |
| `--muted-foreground` | `--gt-text-muted-bright` | secondary text (the lifted dark-mode grey) |
| `--accent` | `--gt-accent-2` | teal — the secondary brand hue, used for deliberate emphasis (healthy/running), **not** generic hover |
| `--accent-foreground` | `--gt-text` | |
| `--destructive` | `--gt-red` | red |
| `--destructive-foreground` | `--gt-inverse` | |
| `--border` | `--gt-border` | hairlines |
| `--input` | `--gt-border` | field borders |
| `--ring` | `--gt-accent` | focus rings |

**Rules that follow from this:**

- Generic hover fills use `--muted`, **never** `--accent`. Teal is an emphasis
  hue, not a hover state (design-system.md §2.1/§2.2).
- The signature gradient (teal → violet) stays `--gt-grad`, applied via the
  `.gt-grad-text` class for the wordmark.
- Depth comes from borders, not fills (§2.1). Cards and menus are `border
  border-border` over the panel, not a re-filled panel.
- Never introduce a raw colour (`bg-zinc-*`, `bg-[#hex]`) — §2.3, enforced.

### Accent swatches

`--gt-accent` (violet) is user-swappable via Settings → Appearance. The shadcn
`--primary` alias means swapping the accent re-tints every primary action
automatically — no component edits.

---

## 2. Typography

IBM Plex Sans (chrome) + IBM Plex Mono (numerics/code/editor), already
registered as `font-sans`/`font-mono` in `index.css` via `@fontsource`.

The dense scale (design-system.md §3): eyebrow `text-[9.5px]` uppercase /
`text-[11px]` secondary / `text-[12px]` headers / `text-[13px]` body /
`text-[17px]` detail titles. Mono is for data (paths, ids, shas, slugs), never
prose or labels.

---

## 3. Radius & spacing

`--radius: 0.5rem` (8px), exposed through `@theme inline` as the `rounded-*`
scale. The value is chosen so the shadcn scale (`sm/md/lg/xl`) is
pixel-identical to Tailwind's defaults — `rounded-md` = 6px, `rounded-lg` = 8px
— which is what the existing UI already uses. Retune `--radius` in one place to
re-round every component.

Density is the reference: controls run 24–28px tall (`h-6`/`h-7`/`h-8`), not
shadcn's 36–40px defaults. Spacing stays on the 4px grid (`gap-1`, `gap-1.5`,
`gap-2`, `p-2`, `p-3`).

---

## 4. Component library

`src/renderer/src/components/ui/` — one file per component, shadcn's new-york
convention (`data-slot`, `cn()`, `cva`). `cn()` lives in
`src/renderer/src/lib/utils.ts` (`clsx` + `tailwind-merge`).

The **legacy** library `src/renderer/src/components/ui.tsx` (+
`lib/controls.ts` `mergeClasses`) still serves the unmigrated call sites and
must keep exporting `Card`/`Stat`/`Row`/`Big`/`Gauge`/`Badge`/`Empty`/`CopyButton`
until the last call site moves (design-system.test.ts checks this). The two
libraries coexist on purpose: `./components/ui` (file) is the legacy one,
`./components/ui/button` etc. is the shadcn one. Do **not** create a
`components/ui/index.ts` barrel that would shadow the legacy file.

### Variant mapping (legacy → shadcn)

| Legacy `ui.tsx` | shadcn `ui/*` |
| --- | --- |
| `Button variant="primary"` | `Button variant="default"` |
| `Button variant="subtle"` | `Button variant="secondary"` |
| `Button variant="ghost"` | `Button variant="ghost"` |
| `Button variant="danger"` | `Button variant="destructive"` |
| `Button size="xs"/"sm"/"md"` | `Button size="xs"/"sm"/"default"` |
| `IconButton` | `Button variant="ghost" size="icon"` + `aria-label` |
| `Input` | `ui/input` `Input` |
| `Select` | `ui/select` `Select` (Radix — API differs; see §5) |
| `Modal` | `ui/dialog` `Dialog` (Radix owns focus trap/backdrop/Escape) |
| `Badge tone="ok|warn|bad|mute|…"` | `ui/badge` `Badge variant="success|warning|destructive|secondary|…"` |

### Available components

`button`, `badge`, `card`, `input`, `label`, `textarea`, `separator`,
`skeleton`, `alert`, `dialog`, `tooltip`, `popover`, `dropdown-menu`, `select`,
`tabs`, `switch`, `checkbox`, `scroll-area`, `progress`.

### Notes

- **Tooltips** need one `TooltipProvider` ancestor (wrap `App`'s tree once).
- **`Dialog`/`Select`/`Dropdown`** use Radix and render in portals — they do not
  inherit the nearest `Card`'s CSS context, but they read the same CSS variables
  so theming is automatic.
- **`busy`** is not a shadcn prop. For a pending action, use `disabled` + a
  `Loader2` spinner + `aria-busy`, exactly as the legacy `Button` did.
- The `[&_svg]:size-*` icon sizing is deliberately the plain form (not
  `[&_svg:not([class*='size-'])])`): the nested quote syntax is fragile under
  this repo's single-quoted string convention. Pass an explicit `size-*` on the
  icon when you need to override.

---

## 5. Migrating a surface (the contract)

Subagents migrate one tab/plugin/component at a time. The pattern:

1. **Swap imports** — `import { Button } from '../components/ui'` →
   `import { Button } from '@/components/ui/button'` (or the equivalent
   relative path). Map variants per the table above.
2. **Replace raw controls** — `<button className="…">` → `<Button>`; `<select>`
   → the Radix `Select` (this one is a real API change — see below); hand-rolled
   `fixed inset-0` overlays → `Dialog`.
3. **Keep the tokens** — `bg-[var(--gt-bg)]`, `text-zinc-500` (remapped in
   CSS), etc. stay valid. Prefer semantic tokens (`bg-muted`,
   `text-muted-foreground`) for *new* code.
4. **No new raw colours / no emoji / two tint steps** — the enforcement tests
   run in CI and fail the build.
5. **Preserve behaviour** — poll intervals, IPC calls, `data-*` attributes
   (`data-tab-id`, `data-tab-pane` — ux-testing.md depends on them), and
   accessibility (icon buttons keep an `aria-label`). A restyle must not change
   a keyboard or screen-reader path.

The Radix `Select` replaces a native `<select>` with a controlled-value
`Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem` tree. When a
surface's `<select>` is a plain form control and a native dropdown is acceptable,
keep the lightweight `ui/input`-style approach or a `DropdownMenu` instead —
don't force Radix `Select` where the native element already works.

---

## 6. iOS port

`ios/TerMinalRemote/Design/Theme.swift` mirrors the `--gt-*` hex values (locked
by `token-parity.test.ts`) and now also carries `GT.radius` (8pt = `--radius:
0.5rem`) and `GT.radiusLg` (12pt = `rounded-xl`). When the brand kit changes a
*token*, change both `index.css` and `Theme.swift`; when it changes a
*component*, mirror the look in the SwiftUI views. SF Symbols are the phone's
lucide (design-system.md §9.3). The shadcn semantic aliases (§1) are a
desktop-only convenience — SwiftUI already reads the `--gt-*` values directly,
so nothing in iOS needs the semantic names.
