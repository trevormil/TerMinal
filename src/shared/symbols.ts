// A file's symbol outline, without a language server.
//
// The IDE audit put LSP as the single cost cliff: go-to-definition, references
// and rename all sit behind it. But a *symbol outline* — "what's in this file,
// jump to it" — delivers most of the day-to-day benefit, and a language-aware
// regex pass gets there at a fraction of the cost. This powers both the outline
// panel and the palette's `@` mode.
//
// Deliberately shallow: it finds declarations, not scopes. Wrong-but-harmless
// beats absent, and anything it misses simply isn't listed.

export type SymbolKind = 'function' | 'class' | 'type' | 'const' | 'method' | 'heading' | 'test'

export type FileSymbol = {
  name: string
  kind: SymbolKind
  /** 1-based, matching editor line numbers. */
  line: number
  /** Nesting depth, for indenting the outline (markdown headings use it). */
  depth: number
}

type Rule = { re: RegExp; kind: SymbolKind; group?: number }

// Order matters: the first rule that matches a line wins, so put the more
// specific patterns first (a `test(...)` line is also a call expression).
const JS_RULES: Rule[] = [
  { re: /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, kind: 'function' },
  { re: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class' },
  { re: /^\s*(?:export\s+)?(?:type|interface)\s+([A-Za-z_$][\w$]*)/, kind: 'type' },
  { re: /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: 'type' },
  // `export const Foo = (...) =>` / `= function` — a declared callable.
  {
    re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\(|function\b|[A-Za-z_$][\w$]*\s*=>)/,
    kind: 'function',
  },
  { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::|=)/, kind: 'const' },
  { re: /^\s*(?:describe|test|it)\s*[.(]\s*[('"`]([^'"`]+)/, kind: 'test' },
  // Class methods: `  foo(` / `  async foo(` at indentation, excluding keywords.
  {
    re: /^\s{2,}(?:public\s+|private\s+|protected\s+|static\s+|async\s+|\*\s*)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/,
    kind: 'method',
  },
]

const PY_RULES: Rule[] = [
  { re: /^\s*class\s+([A-Za-z_]\w*)/, kind: 'class' },
  { re: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/, kind: 'function' },
]

const GO_RULES: Rule[] = [
  { re: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, kind: 'function' },
  { re: /^\s*type\s+([A-Za-z_]\w*)/, kind: 'type' },
]

const RUST_RULES: Rule[] = [
  { re: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/, kind: 'function' },
  { re: /^\s*(?:pub\s+)?(?:struct|enum|trait|type)\s+([A-Za-z_]\w*)/, kind: 'type' },
  { re: /^\s*impl(?:<[^>]*>)?\s+(?:[\w:<>]+\s+for\s+)?([A-Za-z_]\w*)/, kind: 'class' },
]

const SHELL_RULES: Rule[] = [
  { re: /^\s*(?:function\s+)?([A-Za-z_]\w*)\s*\(\)\s*\{/, kind: 'function' },
]

const RULES_BY_EXT: Record<string, Rule[]> = {
  ts: JS_RULES,
  tsx: JS_RULES,
  js: JS_RULES,
  jsx: JS_RULES,
  mjs: JS_RULES,
  cjs: JS_RULES,
  mts: JS_RULES,
  cts: JS_RULES,
  svelte: JS_RULES,
  vue: JS_RULES,
  py: PY_RULES,
  pyw: PY_RULES,
  go: GO_RULES,
  rs: RUST_RULES,
  sh: SHELL_RULES,
  bash: SHELL_RULES,
  zsh: SHELL_RULES,
}

const extOf = (path: string): string => {
  const base = (path.split('/').pop() || path).toLowerCase()
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1) : ''
}

/** Markdown outlines are its headings — depth comes from the `#` count. */
function markdownSymbols(text: string): FileSymbol[] {
  const out: FileSymbol[] = []
  let inFence = false
  text.split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) inFence = !inFence
    if (inFence) return
    const m = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line)
    if (m) out.push({ name: m[2].trim(), kind: 'heading', line: i + 1, depth: m[1].length - 1 })
  })
  return out
}

/**
 * Extract an outline for `path`'s content. Returns [] for languages we have no
 * rules for — an empty outline is honest; a wrong one is worse than none.
 */
export function extractSymbols(path: string, text: string): FileSymbol[] {
  const ext = extOf(path)
  if (ext === 'md' || ext === 'mdx' || ext === 'markdown') return markdownSymbols(text)
  const rules = RULES_BY_EXT[ext]
  if (!rules) return []

  const out: FileSymbol[] = []
  let inBlockComment = false
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Skip comments so a commented-out function isn't listed as real.
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false
      continue
    }
    if (/^\s*\/\*/.test(line) && !line.includes('*/')) {
      inBlockComment = true
      continue
    }
    if (/^\s*(\/\/|#(?!!)|\*)/.test(line) && !/^\s*#\s*(include|define)/.test(line)) continue

    for (const rule of rules) {
      const m = rule.re.exec(line)
      if (m?.[rule.group ?? 1]) {
        const name = m[rule.group ?? 1]
        // Keywords that look like methods under the class-method rule.
        if (rule.kind === 'method' && /^(if|for|while|switch|catch|return|constructor)$/.test(name))
          break
        out.push({
          name,
          kind: rule.kind,
          line: i + 1,
          depth: Math.floor((line.length - line.trimStart().length) / 2),
        })
        break
      }
    }
  }
  return out
}

export const symbolGlyph = (k: SymbolKind): string =>
  ({ function: 'ƒ', class: 'C', type: 'T', const: '=', method: 'm', heading: '#', test: '✓' })[k]
