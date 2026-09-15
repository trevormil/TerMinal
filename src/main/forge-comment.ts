import { forgeErrorReason, run, type ForgeKind } from './forge'
import type { RepoId } from './repo'
import type { PrActionResult } from '../shared/types/github-review'

export async function postDiscussionComment(
  repoRoot: string,
  repo: RepoId,
  kind: ForgeKind,
  iid: number,
  body: string,
): Promise<PrActionResult> {
  if (!Number.isSafeInteger(iid) || iid <= 0)
    return { ok: false, error: 'Choose an existing PR/MR.' }
  if (typeof body !== 'string' || !body.trim())
    return { ok: false, error: 'A comment needs a body.' }
  const cli = kind === 'github' ? 'gh' : 'glab'
  const endpoint =
    kind === 'github'
      ? `repos/${repo.path}/issues/${iid}/comments`
      : `projects/${encodeURIComponent(repo.path)}/merge_requests/${iid}/notes`
  const result = await run(
    cli,
    ['api', '--method', 'POST', endpoint, '--hostname', repo.host, '-f', `body=${body}`],
    repoRoot,
    { timeout: 30_000 },
  )
  return result.err
    ? {
        ok: false,
        error:
          forgeErrorReason(cli, result.err, result.stderr) ||
          'Comment failed. Check forge authentication and retry.',
      }
    : { ok: true }
}
