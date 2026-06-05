import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { app } from 'electron'
import { resolvedProjectsDir, resolvedTemplateRepo } from './settings'
import { cloneTemplateToTmp, pickTemplateSource, templateCandidates, type TemplateSource } from './template'

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
export function scaffoldProject(name: string, parentDir?: string): ScaffoldResult {
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
    cpSync(src.dir, dest, { recursive: true, filter: (s) => !SKIP.has(basename(s)) })
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
    git('init', '-q')
    git('add', '-A')
    git('commit', '-qm', 'chore: scaffold from project-template')
    return { ok: true, path: dest }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  } finally {
    src.cleanup?.()
  }
}
