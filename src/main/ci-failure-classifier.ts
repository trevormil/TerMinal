// CI failure classifier. Deterministic patterns first, OpenRouter haiku
// fallback for ambiguous logs. Used by ticket #0005's webhook receiver to
// decide whether the failure is cheap-class (lint/format/typecheck) and
// safe to auto-fix, or real (test/build/deploy) and should HITL.
//
// Token economics:
//   regex hit  → $0
//   LLM hit    → ~$0.0001 (haiku, ~200 input + 8 output tokens)
//   Alternative (codex-exec the full log) → ~$0.10+

export type FailureClass =
  | 'prettier-formatting'
  | 'eslint-fixable'
  | 'typecheck-isolated'
  | 'snapshot-mismatch'
  | 'test-real'
  | 'build-config'
  | 'deploy-infra'
  | 'dependency'
  | 'lockfile-drift'
  | 'flake-network'
  | 'ambiguous'

export type Classification = {
  class: FailureClass
  confidence: 'high' | 'medium' | 'low'
  evidence: string[]
  /** True when class is safe to attempt an automated fix-and-push (per #0005 v0 allowlist). */
  isCheapClass: boolean
  source: 'heuristic' | 'llm' | 'fallback'
}

const CHEAP_CLASSES: FailureClass[] = ['prettier-formatting']
// (allowlist intentionally tight at v0 per ticket #0005)

// Pattern catalog — ordered most-specific first.
const HEURISTICS: { class: FailureClass; pattern: RegExp; evidence: string }[] = [
  // Prettier
  {
    class: 'prettier-formatting',
    pattern: /\[warn\]\s+Code style issues found|prettier --check.*failed|files would be reformatted/i,
    evidence: 'prettier --check signature',
  },
  // ESLint (auto-fixable subset)
  {
    class: 'eslint-fixable',
    pattern: /\d+\s+(error|problem)s?.*eslint|eslint.*\d+\s+error/i,
    evidence: 'eslint output',
  },
  // TypeScript typecheck
  {
    class: 'typecheck-isolated',
    pattern: /error TS\d+:|TS\d+\s+:|TypeScript:.*error/,
    evidence: 'TS error code signature',
  },
  // Snapshot mismatches
  {
    class: 'snapshot-mismatch',
    pattern: /snapshot file.*was not written|snapshot.*does not match|toMatchSnapshot.*fail|obsolete snapshot/i,
    evidence: 'snapshot fail signature',
  },
  // Real test failures (Vitest/Jest/Bun)
  {
    class: 'test-real',
    pattern: /\d+\s+failing|\d+\s+failed|FAIL\s+|✗\s+|AssertionError|Expected.*Received/,
    evidence: 'test runner failing output',
  },
  // Build / vite / webpack / esbuild
  {
    class: 'build-config',
    pattern: /(rollup|vite|webpack|esbuild|tsup).*(error|failed)|Module not found|Cannot resolve|Cannot find module/i,
    evidence: 'bundler error',
  },
  // Lockfile drift
  {
    class: 'lockfile-drift',
    pattern: /(lockfile|bun\.lock|package-lock).*out of (date|sync)|frozen-lockfile.*failed|lockfile mismatch/i,
    evidence: 'lockfile drift signature',
  },
  // Dependency install
  {
    class: 'dependency',
    pattern: /npm ERR! code E\d+|EPEERINVALID|404 Not Found.*\.tgz|peer dep|ETIMEDOUT.*registry/i,
    evidence: 'npm/dep install failure',
  },
  // Flaky network / infra
  {
    class: 'flake-network',
    pattern: /ECONNRESET|ETIMEDOUT|503 Service Unavailable|429 Too Many Requests|connection refused/i,
    evidence: 'transient network signature',
  },
  // Deploy / k8s / docker
  {
    class: 'deploy-infra',
    pattern: /(ImagePullBackOff|CrashLoopBackOff|kubectl.*error|helm.*failed|docker push.*denied|terraform.*error)/i,
    evidence: 'deploy/infra error',
  },
]

const STRIP_ANSI = /\x1b\[[0-9;?]*[a-zA-Z]/g

/** Heuristic pass. Walks the log + checks each pattern. Returns the first
 *  high-confidence match, or 'ambiguous' when nothing fires. */
export function classifyHeuristic(rawLog: string): Classification {
  const log = rawLog.replace(STRIP_ANSI, '')
  const evidence: string[] = []
  for (const h of HEURISTICS) {
    if (h.pattern.test(log)) {
      evidence.push(h.evidence)
      return {
        class: h.class,
        confidence: 'high',
        evidence,
        isCheapClass: CHEAP_CLASSES.includes(h.class),
        source: 'heuristic',
      }
    }
  }
  return {
    class: 'ambiguous',
    confidence: 'low',
    evidence: ['no pattern matched'],
    isCheapClass: false,
    source: 'heuristic',
  }
}

/** Full classify: heuristic first, OpenRouter haiku fallback. The fallback
 *  is gated on whether OpenRouter is configured AND the heuristic returned
 *  ambiguous. */
export async function classifyCiFailure(rawLog: string): Promise<Classification> {
  const h = classifyHeuristic(rawLog)
  if (h.class !== 'ambiguous') return h
  // Try LLM fallback — routed to claude -p haiku (free via Max subscription)
  // when available; falls back to OpenRouter for non-Anthropic models or
  // when claude isn't installed.
  try {
    const { cheapCall } = await import('./cheap-llm')
    const tail = rawLog.replace(STRIP_ANSI, '').split('\n').slice(-80).join('\n')
    const res = await cheapCall({
      messages: [
        {
          role: 'system',
          content:
            'Classify this CI failure log into EXACTLY ONE label from the set: prettier-formatting, eslint-fixable, typecheck-isolated, snapshot-mismatch, test-real, build-config, deploy-infra, dependency, lockfile-drift, flake-network, ambiguous. Reply with ONLY the label, no preamble.',
        },
        { role: 'user', content: `Log tail:\n${tail}` },
      ],
      model: 'haiku',
      maxTokens: 16,
      temperature: 0,
      timeoutMs: 8000,
    })
    if (res.ok && res.text) {
      const label = res.text.trim().toLowerCase() as FailureClass
      const valid: FailureClass[] = [
        'prettier-formatting',
        'eslint-fixable',
        'typecheck-isolated',
        'snapshot-mismatch',
        'test-real',
        'build-config',
        'deploy-infra',
        'dependency',
        'lockfile-drift',
        'flake-network',
        'ambiguous',
      ]
      if (valid.includes(label)) {
        return {
          class: label,
          confidence: 'medium',
          evidence: ['LLM classifier (haiku)'],
          isCheapClass: CHEAP_CLASSES.includes(label),
          source: 'llm',
        }
      }
    }
  } catch {
    /* fall through */
  }
  return { ...h, source: 'fallback' }
}
