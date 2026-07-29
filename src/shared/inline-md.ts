// Inline-only markdown tokeniser for compact, high-volume rows (the Activity
// feed). react-markdown is too heavy to run per-row across a streaming list and
// its block output breaks single-line truncation, so this handles just the
// inline spans and flattens everything else to text.
//
// Split out of the renderer so the regex logic is unit-testable without a DOM.
// That matters here specifically: the original renderer built its link handler
// inside the exec() loop and closed over the mutable match, which was null by
// click time — a bug no amount of eyeballing the JSX made obvious, and which a
// token-level test catches directly.

export type InlineToken =
  | { kind: 'text' | 'code' | 'bold' | 'italic' | 'strike'; text: string }
  | { kind: 'link'; text: string; href: string }

// Only http(s) is linkified, so a `javascript:` or `file:` target renders as
// plain text rather than something clickable.
//
// Emphasis content must HUG its delimiters (CommonMark's rule): `*x*` is
// emphasis, `* x *` is not. Without that, arithmetic like "2 * 3 * 4" rendered
// " 3 " in italics.
const EMPH = String.raw`[^\s*][^*\n]*?[^\s*]|[^\s*]`
const EMPH_ = String.raw`[^\s_][^_\n]*?[^\s_]|[^\s_]`
const INLINE_RE = new RegExp(
  [
    String.raw`\`([^\`]+)\``,
    String.raw`\*\*([^*]+?)\*\*`,
    String.raw`~~([^~]+?)~~`,
    String.raw`\[([^\]]+?)\]\((https?:\/\/[^)\s]+)\)`,
    String.raw`(?<![\w*])\*(${EMPH})\*(?![\w*])`,
    String.raw`(?<![\w_])_(${EMPH_})_(?![\w_])`,
  ].join('|'),
  'g',
)

/** Tokenise `text` into inline spans, in source order.
 *
 *  `keepLineBreaks` (default false): the clamped/collapsed preview still
 *  flattens to one line so it fits the compact row; an expanded row passes
 *  `true` to keep the source's paragraph breaks instead of rendering
 *  everything as one run-on line. Either way a leading `## Title` marker is
 *  stripped so its hashes don't render literally. */
export function parseInline(text: string, opts?: { keepLineBreaks?: boolean }): InlineToken[] {
  const clean = opts?.keepLineBreaks
    ? text.replace(/[ \t]+/g, ' ').replace(/^\s*#{1,6}\s+/, '')
    : text.replace(/\s*\n+\s*/g, ' ').replace(/^\s*#{1,6}\s+/, '')
  const out: InlineToken[] = []
  let last = 0
  let m: RegExpExecArray | null
  INLINE_RE.lastIndex = 0
  while ((m = INLINE_RE.exec(clean))) {
    if (m.index > last) out.push({ kind: 'text', text: clean.slice(last, m.index) })
    if (m[1] !== undefined) out.push({ kind: 'code', text: m[1] })
    else if (m[2] !== undefined) out.push({ kind: 'bold', text: m[2] })
    else if (m[3] !== undefined) out.push({ kind: 'strike', text: m[3] })
    // Each link carries its own href — never a reference back into `m`, which
    // the loop reassigns and finally leaves null.
    else if (m[4] !== undefined) out.push({ kind: 'link', text: m[4], href: m[5] })
    else if (m[6] !== undefined) out.push({ kind: 'italic', text: m[6] })
    else if (m[7] !== undefined) out.push({ kind: 'italic', text: m[7] })
    last = m.index + m[0].length
  }
  if (last < clean.length) out.push({ kind: 'text', text: clean.slice(last) })
  return out
}
