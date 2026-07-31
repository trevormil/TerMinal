/**
 * Today's calendar date in the USER'S timezone, as `YYYY-MM-DD`.
 *
 * The bug this replaces: `new Date().toISOString().slice(0, 10)` is the **UTC**
 * date. Anywhere west of UTC, every edit after local evening (17:00 PDT, 19:00
 * EDT) stamps TOMORROW's date — on ticket frontmatter `updated:` fields, on
 * loop-log headings, and on the budget day-key, which also means the daily
 * spend cap rolls over hours early. Anywhere east of UTC the same call can
 * stamp yesterday early in the morning.
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
