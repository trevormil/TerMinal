import { forgeErrorReason, run } from './forge'
import type { RepoId } from './repo'
import type { PrActionResult, PrConversation, PrReviewThread } from '../shared/types/github-review'

type Discussion = {
  id: string
  individual_note?: boolean
  notes: {
    id: number
    body: string
    system?: boolean
    resolved?: boolean
    resolvable?: boolean
    created_at?: string
    author?: { username?: string; avatar_url?: string }
    position?: { new_path?: string; old_path?: string; new_line?: number; old_line?: number }
  }[]
}
const endpoint = (repo: RepoId, iid: number) =>
  `projects/${encodeURIComponent(repo.path)}/merge_requests/${iid}/discussions`
const validIid = (iid: number) => Number.isSafeInteger(iid) && iid > 0

export async function gitlabDiscussions(
  repoRoot: string,
  repo: RepoId,
  iid: number,
): Promise<PrConversation> {
  if (!validIid(iid)) return { supported: false, reason: 'Choose an existing MR.' }
  const threads: PrReviewThread[] = []
  for (let page = 1; page <= 100; page++) {
    const result = await run(
      'glab',
      ['api', `${endpoint(repo, iid)}?per_page=100&page=${page}`, '--hostname', repo.host],
      repoRoot,
      { timeout: 30_000 },
    )
    if (result.err)
      return {
        supported: false,
        reason:
          forgeErrorReason('glab', result.err, result.stderr) ||
          'Could not load GitLab discussions. Check authentication and retry.',
      }
    let discussions: Discussion[]
    try {
      discussions = JSON.parse(result.stdout)
      if (
        !Array.isArray(discussions) ||
        discussions.some((d) => !d || typeof d.id !== 'string' || !Array.isArray(d.notes))
      )
        throw new Error('Invalid response')
    } catch {
      return { supported: false, reason: 'GitLab returned an invalid discussion response.' }
    }
    for (const discussion of discussions) {
      const notes = discussion.notes.filter((n) => n && !n.system && typeof n.body === 'string')
      if (!notes.length) continue
      const position = notes[0].position
      threads.push({
        id: discussion.id,
        discussionId: discussion.individual_note ? undefined : discussion.id,
        path: position?.new_path || position?.old_path || 'Discussion',
        line: position?.new_line ?? position?.old_line ?? null,
        diffSide: position?.new_line != null ? 'RIGHT' : 'LEFT',
        resolved:
          notes.some((n) => n.resolvable) &&
          notes.filter((n) => n.resolvable).every((n) => n.resolved),
        resolvable: !discussion.individual_note && notes.some((n) => n.resolvable === true),
        outdated: false,
        replyToId: null,
        comments: notes.map((n) => ({
          id: String(n.id),
          databaseId: n.id,
          body: n.body,
          createdAt: n.created_at || '',
          login: n.author?.username || 'Unknown',
          avatarUrl: n.author?.avatar_url || '',
          url: `https://${repo.host}/${repo.path}/-/merge_requests/${iid}#note_${n.id}`,
        })),
      })
    }
    if (discussions.length < 100)
      return {
        supported: true,
        forge: 'gitlab',
        reviewDecision: '',
        reviewers: [],
        comments: [],
        reviews: [],
        threads,
        markers: [],
      }
  }
  return {
    supported: false,
    reason: 'Too many GitLab discussions to load. Open this MR in GitLab.',
  }
}

export async function postGitlabReply(
  repoRoot: string,
  repo: RepoId,
  iid: number,
  discussionId: string,
  body: string,
): Promise<PrActionResult> {
  if (!validIid(iid) || !/^[a-zA-Z0-9_-]+$/.test(discussionId) || !body.trim())
    return { ok: false, error: 'Choose a discussion and enter a reply.' }
  const result = await run(
    'glab',
    [
      'api',
      '--method',
      'POST',
      `${endpoint(repo, iid)}/${discussionId}/notes`,
      '--hostname',
      repo.host,
      '-f',
      `body=${body}`,
    ],
    repoRoot,
    { timeout: 30_000 },
  )
  return result.err
    ? {
        ok: false,
        error:
          forgeErrorReason('glab', result.err, result.stderr) ||
          'Reply failed. Check GitLab authentication and retry.',
      }
    : { ok: true }
}

export async function setGitlabDiscussionResolved(
  repoRoot: string,
  repo: RepoId,
  iid: number,
  discussionId: string,
  resolved: boolean,
): Promise<PrActionResult> {
  if (!validIid(iid) || !/^[a-zA-Z0-9_-]+$/.test(discussionId) || typeof resolved !== 'boolean')
    return { ok: false, error: 'Choose a GitLab discussion and a resolution state.' }
  const result = await run(
    'glab',
    [
      'api',
      '--method',
      'PUT',
      `${endpoint(repo, iid)}/${discussionId}`,
      '--hostname',
      repo.host,
      '-F',
      `resolved=${resolved}`,
    ],
    repoRoot,
    { timeout: 30_000 },
  )
  return result.err
    ? {
        ok: false,
        error:
          forgeErrorReason('glab', result.err, result.stderr) ||
          'Could not update this discussion. Check GitLab authentication and permissions, then retry.',
      }
    : { ok: true }
}
