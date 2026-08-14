// GitHub-native PR review IPC — checks, conversation, review actions.
//
// `repoRoot` travels as an argument (the `stacks:*` shape) rather than being
// read off the active workspace daemon: this surface is GitHub-only and
// local-only by design, and threading it through the daemon would oblige every
// remote/GitLab daemon to carry five methods that can only answer "no".
//
// The three write channels are user-initiated only. Nothing in main calls them;
// they exist for the review box's buttons, which is the whole reason an agent
// can never approve its own PR through this surface.

import { handle } from '../typed-ipc'
import {
  addComment,
  prChecks,
  prChecksSummaries,
  prConversation,
  replyToThread,
  submitReview,
} from '../github-review'
import type { PrReviewEvent } from '../../shared/types/github-review'

export function registerGithubReviewIpc(): void {
  handle('github-review:checks', (_e, repoRoot: string, iid: number) => prChecks(repoRoot, iid))

  handle('github-review:checks-summaries', (_e, repoRoot: string) => prChecksSummaries(repoRoot))

  handle('github-review:conversation', (_e, repoRoot: string, iid: number) =>
    prConversation(repoRoot, iid),
  )

  handle(
    'github-review:submit',
    (_e, repoRoot: string, iid: number, event: PrReviewEvent, body: string) =>
      submitReview(repoRoot, iid, event, body),
  )

  handle('github-review:comment', (_e, repoRoot: string, iid: number, body: string) =>
    addComment(repoRoot, iid, body),
  )

  handle(
    'github-review:reply',
    (_e, repoRoot: string, iid: number, replyToId: number, body: string) =>
      replyToThread(repoRoot, iid, replyToId, body),
  )
}
