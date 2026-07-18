import { execFileSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { app } from 'electron'
import { resolvedProjectsDir, resolvedTemplateRepo } from './settings'
import {
  cloneTemplateToTmp,
  pickTemplateSource,
  templateCandidates,
  type TemplateSource,
} from './template'
import { saveRepoTicketConfig, scaffoldObsidianVault } from './ticket-provider'
import { resolveObsidianScaffold, type ScaffoldTicketProvider } from './scaffold-vault'
import { bakedTemplateSha, resolveTemplateSha, writeBootstrapStamp } from './bootstrap-stamp'

export type { ScaffoldTicketProvider } // re-exported so callers keep importing from './scaffold'

// Spin up a new repo from the template, which is embedded in this repo at
// templates/project-template (no standalone template repo). Resolution order:
// configured path/URL → source checkout → packaged copy (extraResources) →
// shallow clone of the TerMinal repo, using its templates/ subdir.
const SKIP = new Set(['.git', '.gitmodules', 'node_modules', '.DS_Store'])

export type ScaffoldResult = { ok: boolean; path?: string; error?: string }

function templateSource(): TemplateSource {
  const configured = resolvedTemplateRepo()
  const source = pickTemplateSource({
    candidates: templateCandidates({
      configured,
      appPath: app.getAppPath(),
      // resourcesPath carries the packaged copy (electron-builder extraResources);
      // the template versions with the checkout/app itself, so no upstream pull.
      sourceRoots: [process.resourcesPath || '', process.env.GT_TERMINAL_REPO || '', process.cwd()],
    }),
    marker: 'bootstrap.sh',
    templateRepo: configured,
    cloneToTmp: cloneTemplateToTmp,
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
  const safe = name
    .trim()
    .replace(/[^\w.-]/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!safe || /^\.+$/.test(safe)) return { ok: false, error: 'enter a project name' }
  const parent = parentDir?.trim() || resolvedProjectsDir()
  const dest = join(parent, safe)
  // never traverse out of / clobber: dest must be a brand-new direct child of parent
  if (resolve(dirname(dest)) !== resolve(parent)) return { ok: false, error: 'invalid name' }
  if (existsSync(dest))
    return { ok: false, error: `“${safe}” already exists in that folder — pick a new name` }

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
    // Resolve the vault path + the .gitignore rules to add. The per-machine
    // vault pointer (.TerMinal/tickets.json) is always ignored; an in-repo vault
    // also ignores its own folder. Done BEFORE the first commit so the rules are
    // tracked and the files written below stay ignored.
    const wantsObsidian = ticketProvider?.kind === 'obsidian'
    let obsidianVaultPath = ''
    if (wantsObsidian) {
      const resolved = resolveObsidianScaffold(dest, parent, safe, ticketProvider!)
      obsidianVaultPath = resolved.vaultPath
      try {
        const gi = join(dest, '.gitignore')
        const cur = existsSync(gi) ? readFileSync(gi, 'utf8') : ''
        const have = new Set(cur.split('\n').map((l) => l.trim()))
        const add = resolved.ignore.filter((l) => !have.has(l))
        if (add.length)
          appendFileSync(gi, `${cur && !cur.endsWith('\n') ? '\n' : ''}${add.join('\n')}\n`)
      } catch {
        /* best effort */
      }
    }
    // Template provenance (ticket 0045): stamp WHICH template version was
    // copied, before the first commit so the stamp is tracked like the rest of
    // .TerMinal/ state. sha prefers the actual source checkout's HEAD (local
    // submodule or tmp clone); falls back to the build-time baked submodule sha.
    writeBootstrapStamp(dest, {
      sha: resolveTemplateSha(src.dir, bakedTemplateSha()),
      stampedAt: new Date().toISOString(),
    })
    git('init', '-q')
    git('add', '-A')
    git('commit', '-qm', 'chore: scaffold from project-template')
    // Write the (now-gitignored) provider config + seed the vault after the
    // commit. Best-effort — a failure still returns the repo on local backlog.
    try {
      if (wantsObsidian && obsidianVaultPath) {
        saveRepoTicketConfig(dest, {
          provider: 'obsidian',
          obsidian: {
            vaultPath: obsidianVaultPath,
            ...(ticketProvider!.vaultName?.trim()
              ? { vaultName: ticketProvider!.vaultName.trim() }
              : {}),
          },
        })
        scaffoldObsidianVault({ vaultPath: obsidianVaultPath })
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
