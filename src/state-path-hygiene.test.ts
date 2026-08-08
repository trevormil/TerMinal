import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// Workflow state lives in a per-project sidecar. Anything MODEL-FACING that
// still names a literal `.TerMinal/<area>` path is a silent regression: the
// agent writes its ticket or review straight back into the repo, and a
// collaborator gets it in their next pull. Tools resolve correctly on their
// own; it's hand-written paths in prompts and skills that leak.

const ROOT = join(import.meta.dir, '..')
const AREAS = [
  'backlog',
  'sessions',
  'reviews',
  'checks',
  'reports',
  // Personal state files/dirs that moved to the sidecar ROOT (this refactor's
  // second wave). Naming `.TerMinal/<one of these>` as a write target is the
  // same regression as naming an area.
  'tickets\\.json',
  'notes\\.md',
  'knowledge\\.json',
  'snippets\\.json',
  'meta\\.json',
  'loops',
  'agent-requests',
  'knowledge-rag',
]

// Two literal shapes leak, and the first version of this guard only knew one.
//
// v2 — `.TerMinal/<area>/...`
// v1 — the bare repo-relative dirs (`backlog/`, `.reviews/`, `sessions/`). This
// is the shape that actually shipped: skills carried an explicit "if this is a
// legacy v1 repo, write to .reviews/ instead" branch, and since TerMinal's own
// repo IS v1, every review it wrote landed back in the checkout. Reads may
// still merge the old locations — that is what the ALLOW marker is for — but
// no model-facing line may NAME one as a write target.
const V2_LITERAL = new RegExp(`\\.TerMinal/(${AREAS.join('|')})`)
// Anchored so prose like "docs/reports" or "src/sessions.ts" doesn't trip it:
// the path must start a token and be followed by a path separator or an
// id/glob placeholder, which is how these appear when they're real targets.
const V1_LITERAL = new RegExp(
  String.raw`(^|[\s"'\`(=])\.?(${AREAS.join('|')})/([0-9<*{$]|NNNN|README)`,
)
// The same v1 dirs reached through the repo root instead — `"$ROOT/backlog"`,
// `${REPO}/.reviews`. This shape has no trailing placeholder to key on, so the
// repo-root variable is the tell.
const V1_UNDER_ROOT = new RegExp(
  String.raw`\$\{?(ROOT|REPO|REPO_ROOT|PWD|TERMINAL_REPO|CLAUDE_PROJECT_DIR)\}?/\.?(${AREAS.join('|')})\b`,
)
// The "legacy layout escape hatch" — `[ -d .reviews ] && … echo .reviews`
// style conditionals that pick the in-repo dir when it exists. This shipped
// once already (skills carried an explicit v1 branch and every pre-v2 repo
// matched it), and the bare-word form evades all three path regexes above, so
// it gets its own: a `-d`/`-e` test or `echo` of a bare legacy dir is a write
// route in the making, whatever prose surrounds it.
const ESCAPE_HATCH =
  /(\[+ -[de] |echo )\.?\.(reviews|checks)\b|(\[+ -[de] |echo )(backlog|sessions|reports)\//

const LITERAL = (line: string) =>
  V2_LITERAL.test(line) ||
  V1_LITERAL.test(line) ||
  V1_UNDER_ROOT.test(line) ||
  ESCAPE_HATCH.test(line)

// The sidecar vars are ABSOLUTE. Prefixing one with ANY path yields
// `<prefix>/Users/...`, which silently writes inside the repo — the exact bug
// the migration exists to prevent. This shipped twice: once via $TERMINAL_REPO
// in agent scripts, then again via a differently-named $ROOT in plugin
// helpers, because the first version of this guard only knew the former name.
// So match the SHAPE — a slash immediately before the var — not a prefix name.
const DOUBLED = /\/\$\{?TERMINAL_[A-Z]+_DIR/

// Reading the OLD location is legitimate — the migration is gradual, so
// allocators and listers must still see state that has not moved yet. Such a
// line opts out explicitly with a marker, so the exception is visible in the
// diff and cannot be acquired by accident.
const ALLOW = 'state-path-ok'

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) yield* walk(p)
    else yield p
  }
}

// Every tree whose content a model reads and acts on. `plugin/bin` and
// `plugin/hooks` are as model-facing as the skills that shell out to them, and
// the CLAUDE.md files are read at the top of every session.
const MODEL_FACING_TREES = [
  'plugin/skills',
  'plugin/bin',
  'plugin/hooks',
  // The agent contracts moved here from every repo's .agents/; they are the
  // longest model-facing prose we ship and the likeliest place for a literal
  // path to survive.
  'plugin/agents',
  'plugin/scripts',
  '.agents',
]

const MODEL_FACING_FILES = ['CLAUDE.md', 'templates/project-template/CLAUDE.md']

describe('model-facing content resolves state instead of hardcoding it', () => {
  for (const tree of MODEL_FACING_TREES) {
    test(tree, () => {
      const offenders: string[] = []
      for (const file of walk(join(ROOT, tree))) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (line.includes(ALLOW)) return
            if (LITERAL(line) || DOUBLED.test(line))
              offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}`)
          })
      }
      expect(offenders).toEqual([])
    })
  }

  test('app-side agent prompts and session CLAUDE.md use the injected vars', () => {
    const offenders: string[] = []
    for (const rel of [
      'src/main/agent-catalog.ts',
      'src/main/agents.ts',
      // Composes ticketProviderInstructions — model-facing text that once told
      // agents to write tickets into the in-repo backlog and escaped this scan.
      'src/main/ticket-provider.ts',
      'src/renderer/src/lib/agentPrompts.ts',
      ...MODEL_FACING_FILES,
    ]) {
      readFileSync(join(ROOT, rel), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (line.includes(ALLOW)) return
          if (LITERAL(line) || DOUBLED.test(line)) offenders.push(`${rel}:${i + 1}`)
        })
    }
    expect(offenders).toEqual([])
  })

  test('the guard matches the real bug shape', () => {
    // A guard that cannot fail is not a guard.
    expect(LITERAL('write the artifact to .TerMinal/reviews/<pr>/<sha>.md')).toBe(true)
    expect(LITERAL('write the artifact to $TERMINAL_REVIEWS_DIR/<pr>/<sha>.md')).toBe(false)
    // Personal state FILES moved in the second wave — naming them is now the
    // same regression as naming an area. Repo-owned config stays legitimate.
    expect(LITERAL('read .TerMinal/tickets.json for the provider')).toBe(true)
    expect(LITERAL('append to .TerMinal/loops/<id>/events.jsonl')).toBe(true)
    // The escape-hatch shape that shipped in the code-review skill: a bare-word
    // legacy dir picked by a conditional, invisible to the path regexes.
    expect(
      LITERAL(
        'R=$([ -d .reviews ] && [ ! -f .TerMinal/template.json ] && echo .reviews || echo $TERMINAL_REVIEWS_DIR)',
      ),
    ).toBe(true)
    expect(LITERAL('mkdir -p "$([ -d .checks ] && echo .checks)"')).toBe(true)
    expect(LITERAL('the repo layout marker is .TerMinal/template.json')).toBe(false)
    expect(LITERAL('repo widgets come from .TerMinal/widgets.json')).toBe(false)

    // The v1 shape — what actually shipped, and what the first guard missed.
    // Every one of these is a line that existed in a skill and wrote into the
    // repo on any pre-v2 checkout, TerMinal's own included.
    expect(LITERAL('in that case use .reviews/{{PR_NUMBER}}/{{SHORT_SHA}}.md')).toBe(true)
    expect(LITERAL('or `.reviews/<pr>/<sha>.md` in legacy v1')).toBe(true)
    expect(LITERAL('legacy `backlog/NNNN-*.md`')).toBe(true)
    expect(LITERAL('Open its `sessions/<id>-<slug>/session.md`')).toBe(true)
    expect(LITERAL('legacy v1: reports/<kind>/<short-sha>.md')).toBe(true)
    expect(LITERAL('save frames under `.reviews/<pr-number>/screenshots/`')).toBe(true)
    expect(LITERAL('echo "$ROOT/backlog"')).toBe(true)
    expect(LITERAL('BACKLOG="${REPO}/.reviews"')).toBe(true)
    expect(LITERAL('cd "$CLAUDE_PROJECT_DIR/sessions"')).toBe(true)

    // ...without swallowing ordinary prose and unrelated source paths, or the
    // guard gets suppressed wholesale and stops guarding anything.
    expect(LITERAL('the reports tab renders them')).toBe(false)
    expect(LITERAL('see src/main/sessions.ts for the reader')).toBe(false)
    expect(LITERAL('docs/reports/ is a different thing')).toBe(false)
    expect(LITERAL('tickets live in the backlog, one file each')).toBe(false)
    expect(LITERAL('resolve it with `tm-state-dir backlog`')).toBe(false)
    expect(LITERAL('$TERMINAL_BACKLOG_DIR/NNNN-slug.md')).toBe(false)

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
    // The opt-out must be explicit, not implied by looking like a read.
    expect(LITERAL('scan "$ROOT/.TerMinal/backlog" # state-path-ok: legacy read')).toBe(true)
  })
})
