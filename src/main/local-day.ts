/**
 * Today's calendar date in the USER'S timezone, as `YYYY-MM-DD`.
 *
 * The bug this replaces: `new Date().toISOString().slice(0, 10)` is the **UTC**
 * date. Anywhere west of UTC, every edit after local evening (17:00 PDT, 19:00
 * EDT) stamps TOMORROW's date — on ticket frontmatter `updated:` fields and on
 * loop-log headings. Anywhere east of UTC the same call can stamp yesterday
 * early in the morning.
 *
 * These are all "what day is it for the person using the app" values, so they
 * must use the local calendar day.
 */
export function localDay(at: Date = new Date()): string {
  const y = at.getFullYear()
  const m = String(at.getMonth() + 1).padStart(2, '0')
  const d = String(at.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
