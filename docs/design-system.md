# TerMinal design system

Reverse-engineered from the app, not invented for it. Every rule below is either
a pattern TerMinal already follows well, or a fix for something an audit found.

The reference surface is the **cockpit column** — dense, quiet, information-first.
When a rule here and a screen disagree, the screen is wrong.

---

## [1] What the audit found

Numbers from `src/renderer/src` at the time of writing. They are the reason the
rules are what they are.

| Finding | Count |
|---|---|
| Distinct background values in the renderer | **66** |
| `--gt-bg` + `--gt-panel` share of surface-token uses | **202 / 221** |
| `--gt-elevated` uses | **0** |
| `--gt-panel-2` uses | **1** |
| `--gt-surface-hover` uses | **1** |
| Distinct `--gt-accent` tint opacities | **5** (10/15/20/25/30) |
| Distinct `--gt-panel` opacities | **4** |

Read that as: the app really uses **two surfaces**. The other five tokens are
either vestigial or special-purpose, and the 66 distinct values come almost
entirely from ad-hoc opacity suffixes rather than from deliberate layers.

---

## [2] Surfaces — the rule that matters most

**There are two surfaces. A third is a bug.**

| Token | Use |
|---|---|
| `--gt-bg` | the window. The page you are looking at. |
| `--gt-panel` | anything lifted off it: rails, headers, drawers, list rows. |

Two special-purpose exceptions, both justified by content rather than depth:

| Token | Use |
|---|---|
| `--gt-code-bg` | code blocks and diffs |
| `--gt-terminal-bg` | the PTY viewport, which must match the terminal's own theme |

### [2.1] Depth comes from borders, not fills

A card **inside** a panel must not fill with `--gt-panel` again. It reads as a
third surface, and the reason it looks off is that it *is* off — the same colour
at two depths says the hierarchy is decorative.

Use `border border-[var(--gt-border)]` and let the panel show through.

```
/* wrong — a panel on a panel */
<div className="rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)]">

/* right — depth from the border alone */
<div className="rounded-lg border border-[var(--gt-border)]">
```

### [2.2] Tints are two steps, not five

Accent and semantic colours tint a surface at exactly two strengths:

| Step | Opacity | Means |
|---|---|---|
| **subtle** | `/10` | a state worth noticing — a warning row, a matched filter |
| **active** | `/20` | the thing you selected or are on |

Five accent opacities is not a scale, it is five people each picking one. If a
design needs a third step, the answer is a border or a weight change.

### [2.3] Never introduce a raw colour

No `bg-zinc-*`, no `bg-[#rrggbb]`. If a colour is worth using twice it is worth a
token; if it is used once it is probably a mistake. The original audit found 12
raw uses; they are now zero and the enforcement test asserts the empty list.
Neutral fills (inactive dots, off-state toggle tracks) use the white-overlay
idiom — `bg-white/10` for control fills, `bg-white/20` for small indicator dots
— a tint over whatever surface is beneath, never a named grey at a fixed depth.

---

## [3] Type

One family, one small scale. TerMinal is dense by design and the sizes reflect it.

| Size | Use |
|---|---|
| `text-[9.5px]` uppercase, `tracking-[0.12em]`, `text-zinc-500` | section eyebrow (COCKPIT, SESSION) |
| `text-[11px]` | secondary and metadata |
| `text-[12px] font-semibold` | header / tab titles |
| `text-[13px]` | body and list rows |
| `text-[17px] font-semibold` | detail-view titles only |

Monospace (`--gt-mono`) is for **data**: paths, ids, shas, commands, model slugs.
Never for prose, never for labels.

### [3.1] Colour is hierarchy

`--gt-text` → `--gt-text-soft` → `--gt-text-muted` → `--gt-text-faint`. Four
steps, in that order, and never skip one to "make it pop".

---

## [4] Capitalization

**Every user-facing label starts with a capital.** Buttons, tabs, tags, section
titles, empty states, tooltips.

Sentence case, not Title Case: *"Open run"*, not *"Open Run"*.

**Data is not a label.** These stay exactly as the system reports them, because
changing them would be a lie about what the value is:

- engine ids (`claude`, `codex`, `pi`)
- file paths, branch names, git refs, shas
- commands (`bun run release`)
- model slugs (`claude-opus-5`)
- literal API/JSON field names

The tell: if it round-trips to a config file or a process, it is data.

---

## [5] Icons

**lucide-react only. No emoji in UI.**

Emoji render differently per platform, cannot inherit `currentColor`, and read as
informal in a tool that is otherwise not.

Sizes: `11` inline with text, `13` in buttons, `14` in headers. `strokeWidth={2}`
default, `2.25` when a glyph needs to hold at 11px.

**Two exceptions, and only these:**

1. **Typographic symbols that ARE the content** — `↑`/`↓` for git ahead/behind,
   `⌃⇧` for key hints, `·` as a separator. These are text, not decoration.
2. **Outbound message bodies** — Telegram and push notifications are read in
   other people's clients where an icon font does not exist. `⛔` in a Telegram
   alert is correct; `⛔` in a button is not.

---

## [6] Density

The cockpit is the reference: every row earns its height.

- **No description that restates the title.** A tab called Reports does not need
  "Run artifacts from scheduled agents". Removed in PR #249.
- **No empty chrome.** A bar with nothing in it is worse than no bar — same
  height, less meaning. The Files shortcut strip and the Runs header row both
  went for this reason.
- **Combine rows that say one thing.** Two rows of `label: value` about the same
  subject is one row.
- **Absent, not zero.** A count of `0` for something that has never run reads as
  real data. Show nothing.
- **Empty states are one quiet line.** Not an illustration, not a card.

---

## [7] Components

`src/renderer/src/components/ui.tsx` is the shared surface. Reach for it before
writing a `<div className="rounded-lg border …">`.

| Component | Use |
|---|---|
| `Card` | a titled block inside a panel |
| `Stat` / `Row` | `label: value` pairs |
| `Big` | one headline number with a sub-label |
| `Gauge` | a proportion |
| `Badge` | a status tag |
| `Empty` | the quiet one-liner |
| `CopyButton` | copy-to-clipboard |
| `DetailTabs` | the tab strip on a detail pane |

**A second copy is a bug.** This repo has the receipts: two divergent `fmtUsd`s,
a tab strip that had to be extracted into `DetailTabs` because two copies had
already drifted, and a duplicate agent-entry shape that silently dropped six
fields on save. If you need a variant, add a prop.

---

## [8] Enforcement

Documented rules decay. These are checked by
`src/renderer/src/design-system.test.ts`:

- No emoji in renderer source outside the two exceptions above.
- No raw `bg-zinc-*` / `bg-[#hex]` backgrounds.
- Surface tokens limited to the allowlist in [2].
- Accent/semantic tints limited to `/10` and `/20`.

A rule nobody checks is a rule that decays. The three test-isolation incidents,
the two `fmtUsd` copies, and the drifted tab strip all happened under
documentation that already said not to.

---

## [9] The phone

TerMinal Mobile (`ios/`) is the same product, so the rules above apply — but
SwiftUI is not Tailwind and a thumb is not a cursor. This section says which
rules cross over unchanged, which change form, and which do not apply.

### [9.1] Tokens are shared and enforced

`ios/TerMinalRemote/Design/Theme.swift` mirrors the CSS variables in [2]. It
always claimed to; as of ticket 121 `src/shared/token-parity.test.ts` **fails**
if a hex value drifts or a mobile-only colour appears.

The rule that follows: **a colour the phone needs goes in `index.css` first.**
A mobile-only token is a second palette forming, and the test rejects it.

Raw SwiftUI system colours (`.red`, `.orange`) are banned for the same reason
raw hex is banned on desktop — Apple's `.red` is `#FF3B30` where ours is
`#F87171`, and theirs shifts between iOS releases while ours does not.

### [9.2] Surfaces: two, minus the one touch cannot have

Mobile carries `bg`, `panel`, `panel2`, plus `terminalBg` / `codeBg` — the same
shape as [2]. It does **not** carry `surfaceHover`: there is no hover on touch,
so the token could only ever be dead. `elevated` went with it at zero uses.

`panel2` stays despite being near-vestigial on desktop, because on the phone it
has seven real uses (chat bubbles, the lock screen). **Audit before deleting a
token; a count on one platform says nothing about the other.**

### [9.3] Icons are SF Symbols

SF Symbols is the phone's lucide: a professional set, already present, weight-
matched to the text. Same rule as [5] — no emoji — and the same exceptions.

Symbol *names* (`envelope.open`, `chevron.right`) are data, not labels, and are
exempt from [4] the way engine ids are.

### [9.4] Capitalization applies unchanged

Every user-facing label starts with a capital, and [4]'s data carve-out is
identical. Ticket 121 fixed fourteen lowercase tags (`asking`, `idle`,
`urgent`, `new`, `renamed` …).

### [9.5] Where the phone deliberately differs

- **Sidebars become menus.** The Inbox's category sidebar is a 160pt rail on a
  390pt screen — most of the width. Mobile uses a `Menu` + `Picker` over the
  *same derived list* (`InboxCategories`), so the rules are shared even though
  the affordance is not.
- **Hit targets beat density.** [6]'s compactness stops where a control gets too
  small to hit. When they conflict, the thumb wins.
- **No hover states**, so no hover affordances. What a desktop reveals on hover
  the phone must either show or put behind a swipe or a long-press.

### [9.6] Rules that exist twice

`InboxCategories.swift` is a hand-port of `src/shared/inbox-categories.ts`;
Swift cannot import the TypeScript. The mitigation is that
`InboxCategoriesTests` mirrors the TypeScript suite case for case, with parallel
test names so a diff of the two files is readable.

**When you change one, change both, and check the names still line up.** This
repo has three separate incidents of exactly this shape — two `fmtUsd` copies, a
tab strip that drifted until it had to be extracted, and the token comment that
became this section's test.
