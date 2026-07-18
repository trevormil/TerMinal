import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_TEMPLATE_REPO } from './settings'

export type TemplateSource = { dir: string; cleanup?: () => void }
export type TemplateResolution = TemplateSource | { error: string }

const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i

function isCloneableTemplateRepo(repo: string): boolean {
  const trimmed = repo.trim()
  if (!trimmed || trimmed !== repo) return false
  if (trimmed.startsWith('-')) return false
  if (/[\0\r\n]/.test(trimmed)) return false
  return true
}

export function pickTemplateSource(opts: {
  candidates: { dir: string; explicit?: boolean }[]
  marker: string
  templateRepo: string
  cloneToTmp: (repo: string) => TemplateSource | null
  onLocalPick?: (dir: string) => void
}): TemplateResolution {
  for (const candidate of opts.candidates) {
    const dir = candidate.dir.trim()
    if (!dir) continue
    if (existsSync(join(dir, opts.marker))) {
      opts.onLocalPick?.(dir)
      return { dir }
    }
    if (candidate.explicit && !URL_RE.test(dir)) {
      return { error: `configured template path is missing ${opts.marker}: ${dir}` }
    }
  }

  const repo = opts.templateRepo.trim() || DEFAULT_TEMPLATE_REPO
  if (!isCloneableTemplateRepo(repo))
    return { error: `invalid template repo: ${repo || '(empty)'}` }
  const cloned = opts.cloneToTmp(repo)
  if (!cloned) return { error: `couldn't fetch template from ${repo}` }
  if (existsSync(join(cloned.dir, opts.marker))) return cloned
  // The template lives embedded in the TerMinal repo — a clone of TerMinal (or
  // any repo carrying templates/project-template) resolves to that subdir,
  // with cleanup still tearing down the whole clone.
  const embedded = join(cloned.dir, 'templates', 'project-template')
  if (existsSync(join(embedded, opts.marker))) return { dir: embedded, cleanup: cloned.cleanup }
  cloned.cleanup?.()
  return { error: `template from ${repo} is missing ${opts.marker}` }
}

export function cloneTemplateToTmp(repo: string): TemplateSource | null {
  const tmp = mkdtempSync(join(tmpdir(), 'gt-template-'))
  try {
    execFileSync('git', ['clone', '--depth', '1', '--', repo, tmp], {
      stdio: 'ignore',
      timeout: 60_000,
    })
    return { dir: tmp, cleanup: () => rmSync(tmp, { recursive: true, force: true }) }
  } catch {
    rmSync(tmp, { recursive: true, force: true })
    return null
  }
}

export function templateCandidates(opts: {
  configured: string
  appPath?: string
  sourceRoots?: string[]
}): { dir: string; explicit?: boolean }[] {
  const configured = opts.configured.trim()
  const candidates: { dir: string; explicit?: boolean }[] = []
  if (configured && !URL_RE.test(configured)) candidates.push({ dir: configured, explicit: true })
  for (const root of [opts.appPath || '', ...(opts.sourceRoots || [])]) {
    if (root) candidates.push({ dir: join(root, 'templates', 'project-template') })
  }
  return candidates
}
