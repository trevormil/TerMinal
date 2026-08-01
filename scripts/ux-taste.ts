#!/usr/bin/env bun
// Tier 2 of the UX suite: the AI taste pass.
//
// Screenshots the key surfaces (via the same sandboxed harness tier 1 uses),
// hands them to a vision-capable coding CLI with a rubric anchored in this
// repo's own design language, and writes the result as a Reports-tab artifact
// at `.TerMinal/reports/ux-taste/<sha>.md`.
//
// It is NOT a gate, and must never become one:
//   • it is non-deterministic — two runs disagree, and a merge blocked by a
//     coin flip gets the check disabled within a week, at which point it is
//     worse than no check at all;
//   • it costs money per run;
//   • its findings are judgement calls for a human to triage, not facts.
//
// So: schedule or on demand, always exit 0, never wired into per-PR CI.
// `bun run ux:taste`. See docs/ux-testing.md.

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cheapCall } from '../src/main/cheap-llm'
import { DESIGN_LANGUAGE, RUBRIC } from '../tests/ux/surfaces'

const repoRoot = join(fileURLToPath(new URL('..', import.meta.url)))

const arg = (name: string, fallback: string): string => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

function shortSha(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim()
  } catch {
    return 'unknown'
  }
}

type Shot = { name: string; path: string; intent: string }

/** Phase 1 — capture, delegated to the Playwright runner (see
 *  tests/ux/taste-capture.ts for why it cannot be inlined here). */
function capture(shotDir: string): Shot[] {
  mkdirSync(shotDir, { recursive: true })
  const r = spawnSync('bunx', ['playwright', 'test', '-c', 'playwright.taste.config.ts'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, UX_TASTE_SHOT_DIR: shotDir },
  })
  if (r.status !== 0) throw new Error('screenshot capture failed — see the Playwright output above')
  return JSON.parse(readFileSync(join(shotDir, 'manifest.json'), 'utf8')) as Shot[]
}

/** Phase 2 — judge. Deliberately the existing cheap-LLM path
 *  (src/main/cheap-llm.ts) rather than a new provider integration: it already
 *  routes to whichever coding CLI the user has configured, and those CLIs can
 *  read image files off disk. */
function judge(shots: Shot[], engine: string, model: string) {
  const manifest = shots.map((s) => `- **${s.name}** — ${s.intent}\n  image: ${s.path}`).join('\n')
  const prompt = [
    'You are reviewing screenshots of a desktop developer tool for VISUAL and',
    'ERGONOMIC defects. Open and actually LOOK AT each image file listed below',
    'before writing anything. Do not read or reason about source code.',
    '',
    '## Screenshots',
    manifest,
    '',
    '## Design language',
    DESIGN_LANGUAGE,
    '',
    '## What to report',
    RUBRIC,
  ].join('\n')

  return cheapCall({
    messages: [{ role: 'user', content: prompt }],
    engine: engine as Parameters<typeof cheapCall>[0]['engine'],
    model: model || undefined,
    cwd: repoRoot,
    timeoutMs: 15 * 60_000,
  })
}

function countFindings(body: string): { total: number; high: number } {
  const rows = [...body.matchAll(/^\s*-\s+\*\*(high|medium|low)\*\*/gim)].map((m) =>
    m[1].toLowerCase(),
  )
  return { total: rows.length, high: rows.filter((r) => r === 'high').length }
}

async function main() {
  const engine = arg('engine', 'codex')
  const model = arg('model', '')
  const sha = shortSha()
  const outDir = join(repoRoot, '.TerMinal', 'reports', 'ux-taste')
  const shotDir = join(outDir, 'screens', sha)

  console.error('[ux-taste] capturing surfaces…')
  const shots = capture(shotDir)
  if (process.argv.includes('--capture-only')) {
    console.error(`[ux-taste] captured ${shots.length} to ${shotDir}; skipping the model call`)
    return
  }

  console.error(`[ux-taste] captured ${shots.length}; judging with ${engine}…`)
  const res = await judge(shots, engine, model)
  const body = res.ok ? (res.text || '').trim() : ''
  const { total, high } = countFindings(body)

  mkdirSync(outDir, { recursive: true })
  const file = join(outDir, `${sha}.md`)
  writeFileSync(
    file,
    [
      '---',
      'kind: ux-taste',
      `generated: ${new Date().toISOString()}`,
      `sha: ${sha}`,
      `surfaces: ${shots.length}`,
      `findings: ${total}`,
      `high_severity: ${high}`,
      `engine: ${engine}`,
      `route: ${res.route || 'none'}`,
      `status: ${res.ok ? (high > 0 ? 'warn' : 'ok') : 'error'}`,
      '---',
      '',
      '# UX taste pass',
      '',
      'Non-deterministic visual review. **Advisory only — this never gates a merge.**',
      '',
      `Screenshots: \`${shotDir}\``,
      '',
      res.ok ? body || '_The model returned nothing._' : `## Error\n\n${res.error || 'unknown'}`,
      '',
    ].join('\n'),
  )
  console.error(`[ux-taste] wrote ${file} (${total} findings, ${high} high)`)
}

// Always exit 0. A taste pass that can fail a pipeline is a taste pass that
// will be turned off; read the report instead.
main()
  .catch((e) => console.error('[ux-taste] failed:', e))
  .finally(() => process.exit(0))
