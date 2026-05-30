// MR authorship sniffer — detect which AI tool wrote each commit on an MR.
// The goal is to surface "this MR is 80% Claude / 20% human" on the PRs tab
// so the operator knows what kind of review attention it needs.
//
// We use deterministic heuristics on commit messages + author emails + branch
// names. Optional LLM-based fallback via OpenRouter is available for
// ambiguous commits (uses the cheap default model). Most commits classify
// cleanly without it.

import { execFileSync } from 'node:child_process'

export type AuthorshipTool =
  | 'claude-code' // Anthropic's Claude Code CLI (Co-Authored-By: Claude line)
  | 'codex' // OpenAI Codex CLI
  | 'cursor' // Cursor IDE / Composer
  | 'aider' // Aider
  | 'copilot' // GitHub Copilot
  | 'human'
  | 'unknown'

export type CommitAuthorship = {
  sha: string
  shortSha: string
  authorEmail: string
  authorName: string
  subject: string
  tool: AuthorshipTool
  confidence: 'high' | 'medium' | 'low'
  evidence: string[] // human-readable rationale
}

export type MrAuthorshipSummary = {
  total: number
  byTool: Record<AuthorshipTool, number>
  /** Tool that wrote the most commits (or 'mixed' when no clear winner). */
  dominant: AuthorshipTool | 'mixed'
  /** Per-commit classifications. */
  commits: CommitAuthorship[]
}

// ---- Heuristic patterns ---------------------------------------------------

const PATTERNS: { tool: AuthorshipTool; check: (c: CommitAuthorship & { fullMessage: string }) => string | null }[] = [
  // Claude Code: explicit Co-Authored-By footer
  {
    tool: 'claude-code',
    check: (c) => {
      if (/co-authored-by:\s*claude/i.test(c.fullMessage)) return 'Co-Authored-By: Claude footer'
      if (/🤖\s*generated with \[?claude code\]?/i.test(c.fullMessage))
        return '🤖 Generated with Claude Code footer'
      if (/noreply@anthropic\.com/i.test(c.fullMessage))
        return 'noreply@anthropic.com author/co-author'
      return null
    },
  },
  // Codex: explicit signature lines
  {
    tool: 'codex',
    check: (c) => {
      if (/co-authored-by:\s*(openai\s+)?codex/i.test(c.fullMessage))
        return 'Co-Authored-By: Codex footer'
      if (/generated\s+with\s+codex/i.test(c.fullMessage)) return 'Generated with Codex'
      if (/noreply@openai\.com/i.test(c.fullMessage)) return 'noreply@openai.com co-author'
      return null
    },
  },
  // Cursor: their commit format
  {
    tool: 'cursor',
    check: (c) => {
      if (/cursor\.dev|cursorai|cursor-composer/i.test(c.fullMessage))
        return 'Cursor signature in body'
      if (/composer:/i.test(c.subject)) return 'composer: subject prefix'
      return null
    },
  },
  // Aider
  {
    tool: 'aider',
    check: (c) => {
      if (/aider:/i.test(c.subject)) return 'aider: subject prefix'
      if (/created with aider/i.test(c.fullMessage)) return 'Created with Aider footer'
      return null
    },
  },
  // GitHub Copilot
  {
    tool: 'copilot',
    check: (c) => {
      if (/co-authored-by:\s*github copilot/i.test(c.fullMessage))
        return 'Co-Authored-By: GitHub Copilot footer'
      return null
    },
  },
]

function classifyCommit(
  sha: string,
  authorEmail: string,
  authorName: string,
  subject: string,
  fullMessage: string,
): CommitAuthorship {
  const base: CommitAuthorship & { fullMessage: string } = {
    sha,
    shortSha: sha.slice(0, 7),
    authorEmail,
    authorName,
    subject,
    tool: 'human',
    confidence: 'medium',
    evidence: [],
    fullMessage,
  }
  for (const p of PATTERNS) {
    const reason = p.check(base)
    if (reason) {
      base.tool = p.tool
      base.confidence = 'high'
      base.evidence.push(reason)
      const { fullMessage: _, ...rest } = base
      return rest
    }
  }
  // No AI signature found → human-ish. Lower confidence when the author
  // email is a noreply form (sometimes signals an AI-as-author commit
  // without our known footers).
  if (/noreply|bot/i.test(authorEmail)) {
    base.tool = 'unknown'
    base.confidence = 'low'
    base.evidence.push(`noreply / bot author email (${authorEmail})`)
  } else {
    base.evidence.push('no AI signature found')
  }
  const { fullMessage: _, ...rest } = base
  return rest
}

// ---- MR-level summary -----------------------------------------------------

/** Parse `git log` output for a range and classify each commit. The range
 *  is typically `<base>..<head>` for an MR. Returns a per-MR summary. */
export function authorshipForRange(repoRoot: string, range: string): MrAuthorshipSummary {
  let out = ''
  try {
    // %H sha · %ae author email · %an author name · %s subject · %b body
    // Custom record separator so message bodies (with newlines) don't break parsing.
    out = execFileSync('git', ['log', '--format=__GTSTART__%H%n%ae%n%an%n%s%n%b%n__GTEND__', range], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
  } catch {
    return {
      total: 0,
      byTool: emptyByTool(),
      dominant: 'unknown',
      commits: [],
    }
  }
  const commits: CommitAuthorship[] = []
  const records = out.split('__GTSTART__').slice(1)
  for (const rec of records) {
    const body = rec.replace(/__GTEND__\s*$/, '').trimEnd()
    const lines = body.split('\n')
    const sha = lines[0]?.trim()
    if (!sha) continue
    const email = lines[1]?.trim() || ''
    const name = lines[2]?.trim() || ''
    const subject = lines[3] || ''
    const bodyText = lines.slice(4).join('\n')
    const full = `${subject}\n${bodyText}\n${name} <${email}>`
    commits.push(classifyCommit(sha, email, name, subject, full))
  }
  const byTool = emptyByTool()
  for (const c of commits) byTool[c.tool]++
  return {
    total: commits.length,
    byTool,
    dominant: pickDominant(byTool),
    commits,
  }
}

function emptyByTool(): Record<AuthorshipTool, number> {
  return {
    'claude-code': 0,
    codex: 0,
    cursor: 0,
    aider: 0,
    copilot: 0,
    human: 0,
    unknown: 0,
  }
}

function pickDominant(byTool: Record<AuthorshipTool, number>): MrAuthorshipSummary['dominant'] {
  const entries = Object.entries(byTool).filter(([, n]) => n > 0) as [AuthorshipTool, number][]
  if (entries.length === 0) return 'unknown'
  entries.sort((a, b) => b[1] - a[1])
  const [topTool, topN] = entries[0]
  const total = entries.reduce((s, [, n]) => s + n, 0)
  // Dominant if > 60% of commits. Otherwise mixed.
  if (topN / total > 0.6) return topTool
  return 'mixed'
}

// ---- Compact label for the UI ---------------------------------------------

/** A short label suitable for an MR row badge ("Claude 4/5", "mixed 3/2/1"). */
// ---- LLM fallback for unknown commits ------------------------------------
//
// When the deterministic patterns return 'unknown' or 'human' with low
// confidence, ask OpenRouter haiku to judge the commit style. This catches
// AI-authored commits that don't carry a known footer (e.g., human edited the
// AI commit message). Cheap — ~$0.0001 per ambiguous commit.

const STYLE_SYSTEM_PROMPT =
  'You judge whether a git commit was likely written by Claude Code, Codex (OpenAI), Cursor, Aider, GitHub Copilot, or a human. Reply with EXACTLY ONE of these labels: claude-code, codex, cursor, aider, copilot, human, unknown. No preamble. Signals: "🤖 Generated with Claude Code" is claude-code; "Co-Authored-By: Codex" is codex; Cursor uses "composer:" prefix; Aider uses "aider:" prefix; Copilot uses Copilot footers; conversational style with no signature is usually human; very dense bullet-point body with conventional-commit prefix and 70-char wrap is usually AI but ambiguous.'

/** Reclassify any commit whose initial tool is 'unknown' or 'human' using an
 *  LLM judge. In-place mutation of the summary; returns the same object. */
export async function refineAuthorshipWithLlm(
  s: MrAuthorshipSummary,
  rawMessages?: Map<string, string>,
): Promise<MrAuthorshipSummary> {
  if (!s.commits.length) return s
  let cheapCall: typeof import('./cheap-llm').cheapCall
  try {
    cheapCall = (await import('./cheap-llm')).cheapCall
  } catch {
    return s
  }
  for (const c of s.commits) {
    // Only refine the ambiguous ones; high-confidence patterns stay.
    if (c.confidence === 'high') continue
    if (c.tool !== 'unknown' && c.tool !== 'human') continue
    const msg = rawMessages?.get(c.sha) || `${c.subject}\n${c.authorName} <${c.authorEmail}>`
    try {
      const res = await cheapCall({
        messages: [
          { role: 'system', content: STYLE_SYSTEM_PROMPT },
          { role: 'user', content: msg.slice(0, 1500) },
        ],
        model: 'haiku',
        maxTokens: 8,
        temperature: 0,
        timeoutMs: 5000,
      })
      if (!res.ok || !res.text) continue
      const label = res.text.trim().toLowerCase() as AuthorshipTool
      const valid: AuthorshipTool[] = ['claude-code', 'codex', 'cursor', 'aider', 'copilot', 'human', 'unknown']
      if (valid.includes(label) && label !== c.tool) {
        // Decrement the old bucket, increment the new
        s.byTool[c.tool]--
        c.tool = label
        c.confidence = 'medium'
        c.evidence.push('LLM judge (haiku) reclassified')
        s.byTool[label]++
      }
    } catch {
      /* skip this commit */
    }
  }
  s.dominant = pickDominant(s.byTool)
  return s
}

export function authorshipLabel(s: MrAuthorshipSummary): string {
  if (s.total === 0) return '—'
  const order: AuthorshipTool[] = ['claude-code', 'codex', 'cursor', 'aider', 'copilot', 'human', 'unknown']
  const counts = order
    .filter((t) => s.byTool[t] > 0)
    .map((t) => `${labelFor(t)} ${s.byTool[t]}`)
    .join(' · ')
  return counts
}

export function labelFor(tool: AuthorshipTool): string {
  return {
    'claude-code': 'Claude',
    codex: 'Codex',
    cursor: 'Cursor',
    aider: 'Aider',
    copilot: 'Copilot',
    human: 'Human',
    unknown: '?',
  }[tool]
}
