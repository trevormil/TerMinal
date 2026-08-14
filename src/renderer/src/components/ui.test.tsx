import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Search } from 'lucide-react'
import { Button, IconButton, Input, Select, Toolbar } from './ui'
import { ModalFrame } from './Modal'

// Render smoke, not a DOM suite. `bun test` has no document, so what is checked
// here is the MARKUP contract — the attributes assistive tech and the browser
// read off these controls. The behavioural half (Escape, focus restore, the Tab
// trap, scroll lock) is checked as pure arithmetic in lib/controls.test.ts;
// wiring it end to end needs a DOM environment this repo does not carry yet,
// and the UX suite (`bun run test:ux`) is where that would live.

const html = (node: React.ReactElement): string => renderToStaticMarkup(node)

describe('Button', () => {
  test('renders an inert type=button by default', () => {
    // A bare <button> inside a form submits it. Every migrated call site
    // depended on that NOT happening, so the default is explicit.
    expect(html(<Button>Save</Button>)).toContain('type="button"')
  })

  test('disabled renders the disabled attribute', () => {
    const out = html(<Button disabled>Save</Button>)
    expect(out).toContain('disabled=""')
    expect(out).not.toContain('aria-busy')
  })

  test('busy disables AND announces — not one or the other', () => {
    // The failure this prevents: a pending action that still takes clicks, so
    // the request fires twice; or one that is inert with no announcement, so a
    // screen-reader user is told nothing happened.
    const out = html(<Button busy>Save</Button>)
    expect(out).toContain('disabled=""')
    expect(out).toContain('aria-busy="true"')
  })

  test('busy replaces the icon with the spinner rather than showing both', () => {
    const busy = html(
      <Button busy icon={Search}>
        Find
      </Button>,
    )
    expect(busy).toContain('animate-spin')
    expect(busy).toContain('Find')
    expect(busy.match(/<svg/g)?.length).toBe(1)
  })

  test('an idle button with an icon shows exactly that icon', () => {
    const idle = html(<Button icon={Search}>Find</Button>)
    expect(idle).not.toContain('animate-spin')
    expect(idle.match(/<svg/g)?.length).toBe(1)
  })

  test('variant and size reach the element', () => {
    expect(html(<Button variant="danger">Delete</Button>)).toContain('--gt-red')
    expect(html(<Button size="md">Go</Button>)).toContain('text-[12px]')
  })

  test('arbitrary button props pass through', () => {
    expect(html(<Button title="Save now">Save</Button>)).toContain('title="Save now"')
  })
})

describe('IconButton', () => {
  test('an icon-only control always has an accessible name', () => {
    const out = html(
      <IconButton label="Search files">
        <Search size={11} />
      </IconButton>,
    )
    expect(out).toContain('aria-label="Search files"')
    // title defaults to the label so the mouse affordance matches the a11y one.
    expect(out).toContain('title="Search files"')
  })

  test('an explicit title wins over the label', () => {
    const out = html(
      <IconButton label="Search files" title="Search files (⌘⇧F)">
        <Search size={11} />
      </IconButton>,
    )
    expect(out).toContain('title="Search files (⌘⇧F)"')
    expect(out).toContain('aria-label="Search files"')
  })

  test('busy semantics match Button', () => {
    const out = html(
      <IconButton label="Refresh" busy>
        <Search size={11} />
      </IconButton>,
    )
    expect(out).toContain('disabled=""')
    expect(out).toContain('aria-busy="true"')
  })
})

describe('Input and Select', () => {
  test('Input forwards its props and keeps the field chrome', () => {
    const out = html(<Input placeholder="Filter…" value="x" readOnly />)
    expect(out).toContain('placeholder="Filter…"')
    expect(out).toContain('bg-black/30')
  })

  test('Select renders its options', () => {
    const out = html(
      <Select value="a" onChange={() => {}}>
        <option value="a">A</option>
      </Select>,
    )
    expect(out).toContain('>A</option>')
    expect(out).toContain('focus:border-[var(--gt-accent)]/60')
  })
})

describe('Toolbar', () => {
  test('bordered adds the rule; plain does not', () => {
    expect(html(<Toolbar bordered>x</Toolbar>)).toContain('border-b')
    expect(html(<Toolbar>x</Toolbar>)).not.toContain('border-b')
  })
})

describe('ModalFrame aria contract', () => {
  const frame = (props: Partial<Parameters<typeof ModalFrame>[0]> = {}) =>
    html(
      <ModalFrame titleId="t1" onClose={() => {}} {...props}>
        body
      </ModalFrame>,
    )

  test('a titled dialog is named by its own heading', () => {
    const out = frame({ title: 'Rename note' })
    expect(out).toContain('role="dialog"')
    expect(out).toContain('aria-modal="true"')
    expect(out).toContain('aria-labelledby="t1"')
    expect(out).toContain('id="t1"')
    // Both names at once is worse than one: they compete. Scoped to the dialog
    // element — the close button legitimately carries its own aria-label.
    expect(out.slice(0, out.indexOf('>'))).not.toContain('aria-label=')
  })

  test('an untitled dialog falls back to an explicit label, never to nothing', () => {
    const out = frame({ label: 'File preview' })
    expect(out).toContain('aria-label="File preview"')
    expect(out).not.toContain('aria-labelledby')
  })

  test('a dialog with neither still has a name', () => {
    expect(frame()).toContain('aria-label="Dialog"')
  })

  test('the shell is focusable programmatically but not by Tab', () => {
    expect(frame({ title: 'X' })).toContain('tabindex="-1"')
  })

  test('the close control is named for a screen reader', () => {
    expect(frame({ title: 'X' })).toContain('aria-label="Close"')
  })

  test('a header is drawn only when there is something to put in it', () => {
    // §6 density: a bar with nothing in it is worse than no bar.
    expect(frame()).not.toContain('aria-label="Close"')
  })

  test('the footer renders only when supplied', () => {
    expect(frame({ footer: <span>ft</span> })).toContain('ft')
  })

  test('the body scrolls by default and yields when the content owns scrolling', () => {
    // FileModal embeds CodeMirror, which scrolls itself. Two nested scrollers
    // means the outer one steals the wheel and the editor can never be scrolled
    // to its own last line.
    expect(frame({ title: 'X' })).toContain('overflow-y-auto')
    const owned = frame({ title: 'X', scrollBody: false })
    expect(owned).not.toContain('overflow-y-auto')
    expect(owned).toContain('min-h-0 flex-1 overflow-hidden')
  })
})
