import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { app } from 'electron'
import { resolvedProjectsDir, resolvedTemplateRepo } from './settings'
import {
  cloneTemplateToTmp,
  fillLicense,
  pickTemplateSource,
  templateCandidates,
  type TemplateSource,
} from './template'
import { bakedTemplateSha, resolveTemplateSha, writeBootstrapStamp } from './bootstrap-stamp'

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
export function scaffoldProject(name: string, parentDir?: string): ScaffoldResult {
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
    // The template's LICENSE ships {{YEAR}}/{{AUTHOR}} placeholders, so fill them
    // from the scaffolding user's own git identity — otherwise every new repo
    // would claim the template author's copyright.
    const license = join(dest, 'LICENSE')
    if (existsSync(license)) {
      let author = ''
      try {
        author = execFileSync('git', ['config', '--get', 'user.name'], { encoding: 'utf8' }).trim()
      } catch {
        /* no git identity configured — fillLicense falls back to a neutral holder */
      }
      try {
        writeFileSync(
          license,
          fillLicense(readFileSync(license, 'utf8'), author, new Date().getFullYear()),
        )
      } catch {
        /* a placeholder LICENSE is better than a failed scaffold */
      }
    }
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
    // Template provenance (ticket 0045): stamp WHICH template version was
    // copied. Lives in the SIDECAR now (machine-local bookkeeping), written
    // after `git init` so the sidecar key resolves against a real repo. sha
    // prefers the actual source checkout's HEAD (local submodule or tmp
    // clone); falls back to the build-time baked submodule sha.
    writeBootstrapStamp(dest, {
      sha: resolveTemplateSha(src.dir, bakedTemplateSha()),
      stampedAt: new Date().toISOString(),
    })
    git('add', '-A')
    git('commit', '-qm', 'chore: scaffold from project-template')
    return { ok: true, path: dest }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  } finally {
    src.cleanup?.()
  }
}
