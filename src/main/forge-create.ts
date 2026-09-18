import { forgeFor, forgeErrorReason, run, type ForgeKind } from './forge'
import { repoForCwd, type RepoId } from './repo'
import { readSettings, type ForgePref } from './settings'
import type {
  ForgeCreateInput,
  ForgeCreateContext,
  ForgeCreateResult,
} from '../shared/forge-create'

export function forgeCreateAvailability(repo: RepoId | null, pref: ForgePref): string {
  if (!repo) return 'Add a GitHub or GitLab origin remote to create a PR/MR.'
  if (pref !== 'auto' || /(^|\.)(github|gitlab)\./i.test(repo.host)) return ''
  return 'This forge is unsupported or unrecognized. For a self-hosted GitHub/GitLab instance, select its forge in Settings.'
}

export async function forgeCreateContext(repoRoot: string): Promise<ForgeCreateContext> {
  const forge = forgeFor(repoRoot)
  const repo = repoForCwd(repoRoot)
  const error = forgeCreateAvailability(repo, readSettings().forge)
  if (error) return { repoRoot, label: forge.label, head: '', base: '', error }
  const head = await run('git', ['branch', '--show-current'], repoRoot)
  const base = await run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], repoRoot)
  return {
    repoRoot,
    label: forge.label,
    head: head.stdout.trim(),
    base: base.err ? '' : base.stdout.trim().replace(/^origin\//, ''),
  }
}

export function forgeCreateArgs(kind: ForgeKind, path: string, input: ForgeCreateInput): string[] {
  return kind === 'github'
    ? [
        'api',
        '--method',
        'POST',
        'repos/' + path + '/pulls',
        '-f',
        'title=' + input.title,
        '-f',
        'body=' + input.body,
        '-f',
        'head=' + input.head,
        '-f',
        'base=' + input.base,
      ]
    : [
        'api',
        '--method',
        'POST',
        'projects/' + encodeURIComponent(path) + '/merge_requests',
        '-f',
        'title=' + input.title,
        '-f',
        'description=' + input.body,
        '-f',
        'source_branch=' + input.head,
        '-f',
        'target_branch=' + input.base,
      ]
}

export async function createForgeRequest(
  repoRoot: string,
  repo: RepoId,
  kind: ForgeKind,
  input: ForgeCreateInput,
): Promise<ForgeCreateResult> {
  if (
    !input ||
    !['title', 'head', 'base'].every(
      (key) =>
        typeof input[key as keyof ForgeCreateInput] === 'string' &&
        input[key as keyof ForgeCreateInput].trim(),
    ) ||
    typeof input.body !== 'string'
  )
    return { error: 'Title, source branch, and target branch are required.' }
  if (input.head === input.base) return { error: 'Source and target branches must differ.' }
  const cli = kind === 'github' ? 'gh' : 'glab'
  const args = forgeCreateArgs(kind, repo.path, input)
  args.push('--hostname', repo.host)
  const result = await run(cli, args, repoRoot, { timeout: 30_000 })
  if (result.err) return { error: forgeErrorReason(cli, result.err, result.stderr) }
  try {
    const value = JSON.parse(result.stdout)
    const url = kind === 'github' ? value.html_url : value.web_url
    if (typeof url === 'string' && /^https?:\/\//.test(url)) return { url }
  } catch {
    /* Successful responses must include the created request URL. */
  }
  return { error: 'The forge did not return a PR/MR URL. Check the forge before retrying.' }
}
