// PR risk classifier (for ticket #0006's risk_tier column).
//
// Heuristic-first on file paths + diff size. LLM fallback only for the
// ambiguous middle. Most PRs land in the heuristic tier (e.g. docs-only
// PRs are obviously low risk; PRs touching migrations are obviously high).
// The LLM picks up the genuinely judgment-required ones.

export type RiskTier = 'low' | 'medium' | 'high'

export type RiskInput = {
  /** File paths touched (basename or full relative path). */
  files: string[]
  /** Total added + deleted lines across the diff. */
  diffLines?: number
  /** Optional PR title — used only as LLM context for ambiguous cases. */
  title?: string
}

export type RiskClassification = {
  tier: RiskTier
  confidence: 'high' | 'medium' | 'low'
  evidence: string[]
  source: 'heuristic' | 'llm' | 'fallback'
}

// HIGH-risk file path patterns — touch any of these and the PR is high risk
// regardless of the rest. Errs on the side of "review this carefully."
const HIGH_PATTERNS = [
  /(^|\/)migrations?\//i,
  /(^|\/)db\//i,
  /\bschema\.prisma$|\bschema\.sql$|\.sql$/i,
  /\bauth\b|\bauthz?\b|\bsession\b|\boauth\b/i,
  /\bpayments?\b|\bbilling\b|\bstripe\b|\bcheckout\b/i,
  /(^|\/)k8s\/|(^|\/)kubernetes\/|(^|\/)helm\/|deployment\.ya?ml$/i,
  /(^|\/)terraform\/|\.tf$/i,
  /\bsecrets?\b|\.env(\.|$)|credentials/i,
  /(^|\/)\.github\/workflows\//i,
]

// LOW-risk patterns — when ALL touched files match low patterns AND diff is
// small enough, classify as low.
const LOW_PATTERNS = [
  /\.md$/i,
  /(^|\/)docs?\//i,
  /(^|\/)CHANGELOG\.md$/i,
  /(^|\/)README/i,
  /(^|\/)\.gitignore$/i,
  /(^|\/)\.editorconfig$/i,
  /(^|\/)LICENSE/i,
  /(^|\/)\.prettierrc/i,
  /(^|\/)snapshots?\//i, // snapshot diffs are usually mechanical
]

const SMALL_DIFF_LINES = 50
const LARGE_DIFF_LINES = 500

export function classifyRiskHeuristic(input: RiskInput): RiskClassification {
  const evidence: string[] = []
  if (!input.files.length) {
    return {
      tier: 'low',
      confidence: 'low',
      evidence: ['no files'],
      source: 'heuristic',
    }
  }

  // High-risk wins first — single high-risk file flips the whole PR.
  for (const f of input.files) {
    for (const p of HIGH_PATTERNS) {
      if (p.test(f)) {
        evidence.push(`high-risk path: ${f}`)
        return {
          tier: 'high',
          confidence: 'high',
          evidence,
          source: 'heuristic',
        }
      }
    }
  }

  // Diff-size floor — anything > LARGE_DIFF_LINES is at least medium, even
  // if file paths are tame.
  const big = (input.diffLines || 0) > LARGE_DIFF_LINES

  // Low-risk: ALL files match LOW_PATTERNS AND diff is small.
  const allLow = input.files.every((f) => LOW_PATTERNS.some((p) => p.test(f)))
  const small = (input.diffLines || 0) <= SMALL_DIFF_LINES
  if (allLow && small) {
    evidence.push('all docs/config; small diff')
    return {
      tier: 'low',
      confidence: 'high',
      evidence,
      source: 'heuristic',
    }
  }
  if (allLow && !big) {
    evidence.push('all docs/config; medium diff')
    return {
      tier: 'low',
      confidence: 'medium',
      evidence,
      source: 'heuristic',
    }
  }

  // Big diff bumps to at least medium
  if (big) {
    evidence.push(`large diff (${input.diffLines} lines)`)
    return {
      tier: 'medium',
      confidence: 'high',
      evidence,
      source: 'heuristic',
    }
  }

  // Middle ground — code changes, not obviously high or low. LLM territory.
  return {
    tier: 'medium',
    confidence: 'low',
    evidence: ['code changes; no clear signal'],
    source: 'heuristic',
  }
}

export async function classifyRisk(input: RiskInput): Promise<RiskClassification> {
  const h = classifyRiskHeuristic(input)
  // Only escalate to LLM when heuristic confidence is low — i.e. the ambiguous
  // middle. High-confidence heuristic results stand.
  if (h.confidence !== 'low') return h
  try {
    const { cheapCall } = await import('./cheap-llm')
    const summary =
      `Title: ${input.title || '(no title)'}\n` +
      `Files (${input.files.length}): ${input.files.slice(0, 30).join(', ')}` +
      (input.files.length > 30 ? `… +${input.files.length - 30} more` : '') +
      (input.diffLines ? `\nDiff size: ${input.diffLines} lines` : '')
    const res = await cheapCall({
      messages: [
        {
          role: 'system',
          content:
            "Rate this PR's review-priority risk as EXACTLY ONE of: low, medium, high. high = touches auth/payments/migrations/external APIs OR has architectural surface; medium = non-trivial code changes; low = docs/config/trivial. Reply with ONLY the label, no preamble.",
        },
        { role: 'user', content: summary },
      ],
      model: 'haiku',
      maxTokens: 8,
      temperature: 0,
      timeoutMs: 6000,
    })
    if (res.ok && res.text) {
      const label = res.text.trim().toLowerCase() as RiskTier
      if (label === 'low' || label === 'medium' || label === 'high') {
        return {
          tier: label,
          confidence: 'medium',
          evidence: [...h.evidence, 'LLM judge (haiku)'],
          source: 'llm',
        }
      }
    }
  } catch {
    /* fall through */
  }
  return { ...h, source: 'fallback' }
}
