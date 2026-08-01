// Layout facts a human sees and no unit test can.
//
// Two defect classes from one day:
//   • an empty state that occupied vertical space while showing nothing —
//     read as invisible in review, rendered as phantom margin in the app;
//   • controls cramped or truncated because nobody ever laid the surface out
//     at a small window.

import { test, expect } from './app'

/** The narrowest window the app is expected to stay usable at. There is no
 *  `minWidth` on the BrowserWindow, so this is a suite-owned contract until
 *  main sets one — keep the two in sync if it ever does. */
const MIN_WIDTH = 1000
const MIN_HEIGHT = 700

test('no tab overflows horizontally at the minimum supported window width', async ({ ux }) => {
  await ux.page.setViewportSize({ width: MIN_WIDTH, height: MIN_HEIGHT })
  const offenders: string[] = []
  for (const id of await ux.tabIds()) {
    await ux.openTab(id)
    await ux.page.waitForTimeout(800)
    const over = await ux.page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    // 1px of subpixel rounding is noise; anything more means the page body
    // itself scrolls sideways, which is never intended.
    if (over > 1) offenders.push(`${id} (+${over}px)`)
  }
  expect(offenders, 'tabs whose page body scrolls horizontally').toEqual([])
})

test('no tab renders a blank block that takes up space', async ({ ux }) => {
  // The iOS Inbox defect, generalised: a container with no content, no image
  // and no styling of its own, still consuming vertical space. Reading the code
  // said "invisible"; running it said otherwise.
  const offenders: string[] = []
  for (const id of await ux.tabIds()) {
    await ux.openTab(id)
    await ux.page.waitForTimeout(800)
    const found = await ux.page.evaluate(() => {
      const bad: string[] = []
      for (const el of Array.from(document.querySelectorAll('div, section, li'))) {
        const html = el as HTMLElement
        if (html.children.length > 0) continue
        if ((html.textContent || '').trim().length > 0) continue
        // Only what the user can actually see. Panes for inactive tabs stay
        // mounted, and their boxes would otherwise be reported on every tab.
        if (!html.checkVisibility?.()) continue
        // xterm renders every terminal row as a div, blank rows included. That
        // is a third-party render surface, not app layout.
        if (html.closest('.xterm')) continue
        const r = html.getBoundingClientRect()
        if (r.height <= 12 || r.width <= 40) continue
        const cs = getComputedStyle(html)
        // A deliberately-blank block is fine if it is *drawing* something —
        // a rule, a swatch, a background. It is only a defect when it is
        // invisible yet occupying layout.
        const draws =
          cs.backgroundImage !== 'none' ||
          !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) ||
          cs.borderTopWidth !== '0px' ||
          cs.borderBottomWidth !== '0px' ||
          cs.boxShadow !== 'none'
        if (draws) continue
        if (cs.position === 'absolute' || cs.position === 'fixed') continue
        // An empty `flex-1` in a ROW is a spacer that pushes its siblings
        // apart — deliberate and everywhere in this codebase. The defect being
        // hunted is vertical: an empty block eating height in a column/block
        // flow, which is what phantom margin looks like.
        const parent = html.parentElement
        const pcs = parent ? getComputedStyle(parent) : null
        if (pcs && /flex|inline-flex/.test(pcs.display) && pcs.flexDirection.startsWith('row'))
          continue
        bad.push(`${html.className || html.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`)
      }
      return bad
    })
    for (const f of found) offenders.push(`${id}: ${f}`)
  }
  expect(offenders, 'invisible blocks consuming layout space').toEqual([])
})

test('an empty list renders a legible empty state, not dead space', async ({ ux }) => {
  await ux.openTab('mrs')
  await ux.page.waitForTimeout(2000)
  // Whatever the MRs tab settles on, the pane must carry readable content: the
  // Runs-tab defect was an information-free row that nothing asserted against.
  const box = ux.page.locator('body')
  const text = (await box.innerText()).trim()
  expect(text.length, 'the MRs pane rendered no legible text').toBeGreaterThan(20)
})
