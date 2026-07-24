// Framing for programmatic pty input (phone-spawned initial prompts).
// A raw multiline write is ambiguous to agent TUIs: embedded \n acts as a
// submit boundary, so "line one\nline two" runs line one and then fires the
// rest as separate commands. Bracketed paste (ESC[200~ … ESC[201~) marks the
// whole block as literal text; the caller's single trailing \r submits it.
export function frameInitialInput(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  if (!normalized.includes('\n')) return normalized
  return `\x1b[200~${normalized}\x1b[201~`
}
