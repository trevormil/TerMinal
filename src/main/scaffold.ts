import { execFileSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { app } from 'electron'
import { resolvedProjectsDir, resolvedTemplateRepo } from './settings'
import { cloneTemplateToTmp, pickTemplateSource, templateCandidates, type TemplateSource } from './template'
import { saveRepoTicketConfig, scaffoldObsidianVault } from './ticket-provider'

// Optional ticket-provider choice made at bootstrap. Only 'local' (default) and
// 'obsidian' are offered in the new-project flow; github/linear are configured
// later in Settings. Obsidian needs a vault path (a folder outside the repo).
export type ScaffoldTicketProvider = { kind: 'local' | 'obsidian'; vaultPath?: string }

// Spin up a new repo from the configured template (default:
// github.com/trevormil/project-template). In dev the template ships as a git
// submodule (templates/project-template); the packaged app doesn't bundle it,
// so fall back to a shallow clone of the configured repo (always latest).
const SKIP = new Set(['.git', '.gitmodules', 'node_modules', '.DS_Store'])

export type ScaffoldResult = { ok: boolean; path?: string; error?: string }

function templateSource(): TemplateSource {
  const configured = resolvedTemplateRepo()
  const source = pickTemplateSource({
    candidates: templateCandidates({
      configured,
      appPath: app.getAppPath(),
      sourceRoots: [process.env.GT_TERMINAL_REPO || '', process.cwd()],
    }),
    marker: 'bootstrap.sh',
    templateRepo: configured,
    cloneToTmp: cloneTemplateToTmp,
    onLocalPick: (dir) => {
      // refresh to the latest upstream so scaffolds track the maintained template
      try {
        execFileSync('git', ['-C', dir, 'pull', '--ff-only'], { stdio: 'ignore', timeout: 15_000 })
      } catch {
        /* offline / detached — use the pinned checkout as-is */
      }
    },
  })
  if ('error' in source) throw new Error(source.error)
  return source
}

/** Create <parentDir>/<name> from the template: copy → git init → first commit. */
export function scaffoldProject(
  name: string,
  parentDir?: string,
  ticketProvider?: ScaffoldTicketProvider,
): ScaffoldResult {
  const safe = name.trim().replace(/[^\w.-]/g, '-').replace(/^-+|-+$/g, '')
  if (!safe || /^\.+$/.test(safe)) return { ok: false, error: 'enter a project name' }
  const parent = parentDir?.trim() || resolvedProjectsDir()
  const dest = join(parent, safe)
  // never traverse out of / clobber: dest must be a brand-new direct child of parent
  if (resolve(dirname(dest)) !== resolve(parent)) return { ok: false, error: 'invalid name' }
  if (existsSync(dest)) return { ok: false, error: `“${safe}” already exists in that folder — pick a new name` }

  let src: { dir: string; cleanup?: () => void }
  try {
    src = templateSource()
  } catch (e) {
    return { ok: false, error: `couldn't fetch template — ${(e as Error).message}` }
  }
  try {
    mkdirSync(dest, { recursive: true })
    // Exclude the top-level modules/ registry — that's factory-only, not something
    // every app repo should carry. Modules seed into a repo via the module system,
    // not by copying the catalog. (Matches only the top-level dir, not nested ones.)
    const modulesDir = join(src.dir, 'modules')
    cpSync(src.dir, dest, {
      recursive: true,
      filter: (s) => !SKIP.has(basename(s)) && s !== modulesDir,
    })
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', dest, ...args], {
        stdio: 'ignore',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || 'TerMinal',
          GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || 'noreply@terminal.local',
          GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || 'TerMinal',
          GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || 'noreply@terminal.local',
        },
      })
    const wantsObsidian = ticketProvider?.kind === 'obsidian'
    // Keep the per-machine vault pointer out of git BEFORE the first commit so
    // the ignore rule is committed and tickets.json (written below) is ignored.
    if (wantsObsidian) {
      try {
        const gi = join(dest, '.gitignore')
        const line = '.TerMinal/tickets.json'
        const cur = existsSync(gi) ? readFileSync(gi, 'utf8') : ''
        if (!cur.split('\n').some((l) => l.trim() === line)) {
          appendFileSync(gi, `${cur && !cur.endsWith('\n') ? '\n' : ''}${line}\n`)
        }
      } catch {
        /* best effort */
      }
    }
    git('init', '-q')
    git('add', '-A')
    git('commit', '-qm', 'chore: scaffold from project-template')
    // Set the ticket provider after the commit. Writes the now-gitignored
    // .TerMinal/tickets.json + seeds the vault. Best-effort — config is optional,
    // so a failure still returns the scaffolded repo on the default local backlog.
    try {
      if (wantsObsidian) {
        // Default the vault to a sibling folder next to the repo (outside its git
        // tree) when the caller didn't pick one.
        const vaultPath = ticketProvider!.vaultPath?.trim() || join(parent, `${safe}-vault`)
        saveRepoTicketConfig(dest, { provider: 'obsidian', obsidian: { vaultPath } })
        scaffoldObsidianVault({ vaultPath })
      }
    } catch {
      /* leave the new repo on local backlog */
    }
    return { ok: true, path: dest }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  } finally {
    src.cleanup?.()
  }
}
