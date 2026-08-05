import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// Workflow state lives in a per-project sidecar. Anything MODEL-FACING that
// still names a literal `.TerMinal/<area>` path is a silent regression: the
// agent writes its ticket or review straight back into the repo, and a
// collaborator gets it in their next pull. Tools resolve correctly on their
// own; it's hand-written paths in prompts and skills that leak.

const ROOT = join(import.meta.dir, '..')
const AREAS = ['backlog', 'sessions', 'reviews', 'checks', 'reports']
const LITERAL = new RegExp(`\\.TerMinal/(${AREAS.join('|')})`)

// The sidecar vars are ABSOLUTE. Prefixing one with ANY path yields
// `<prefix>/Users/...`, which silently writes inside the repo — the exact bug
// the migration exists to prevent. This shipped twice: once via $TERMINAL_REPO
// in agent scripts, then again via a differently-named $ROOT in plugin
// helpers, because the first version of this guard only knew the former name.
// So match the SHAPE — a slash immediately before the var — not a prefix name.
const DOUBLED = /\/\$\{?TERMINAL_[A-Z]+_DIR/

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) yield* walk(p)
    else yield p
  }
}

const MODEL_FACING_TREES = [
  'plugin/skills',
  '.agents',
  'templates/project-template/.agents',
  'templates/project-template/.codex/skills',
]

describe('model-facing content resolves state instead of hardcoding it', () => {
  for (const tree of MODEL_FACING_TREES) {
    test(tree, () => {
      const offenders: string[] = []
      for (const file of walk(join(ROOT, tree))) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (LITERAL.test(line) || DOUBLED.test(line))
              offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}`)
          })
      }
      expect(offenders).toEqual([])
    })
  }

  test('app-side agent prompts use the injected vars', () => {
    const offenders: string[] = []
    for (const rel of [
      'src/main/agent-catalog.ts',
      'src/main/agents.ts',
      'src/renderer/src/lib/agentPrompts.ts',
    ]) {
      readFileSync(join(ROOT, rel), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (LITERAL.test(line) || DOUBLED.test(line)) offenders.push(`${rel}:${i + 1}`)
        })
    }
    expect(offenders).toEqual([])
  })

  test('the guard matches the real bug shape', () => {
    // A guard that cannot fail is not a guard.
    expect(LITERAL.test('write the artifact to .TerMinal/reviews/<pr>/<sha>.md')).toBe(true)
    expect(LITERAL.test('write the artifact to $TERMINAL_REVIEWS_DIR/<pr>/<sha>.md')).toBe(false)
    // `.TerMinal/` itself is still legitimate for repo config (template.json,
    // tickets.json, widgets.json) — only the state AREAS moved.
    expect(LITERAL.test('read .TerMinal/tickets.json for the provider')).toBe(false)

    // The doubled form: an absolute sidecar var pasted after the repo root.
    expect(DOUBLED.test('reports_dir="$TERMINAL_REPO/$TERMINAL_REPORTS_DIR"')).toBe(true)
    expect(DOUBLED.test('grep title "$TERMINAL_REPO"/$TERMINAL_BACKLOG_DIR/*.md')).toBe(true)
    // Any prefix name, not just the one we thought of first:
    expect(DOUBLED.test('echo "$ROOT/$TERMINAL_BACKLOG_DIR"')).toBe(true)
    expect(DOUBLED.test('`<repo-root>/$TERMINAL_BACKLOG_DIR/NNNN.md`')).toBe(true)
    // The var used bare, or with a suffix, is correct.
    expect(DOUBLED.test('reports_dir="$TERMINAL_REPORTS_DIR"')).toBe(false)
    expect(DOUBLED.test('ls "$TERMINAL_BACKLOG_DIR"/[0-9]*.md')).toBe(false)
    expect(DOUBLED.test('git -C "$TERMINAL_REPO" log')).toBe(false)
  })
})
