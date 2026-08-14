export type GitCommit = {
  sha: string
  shortSha: string
  parents: string[]
  author: string
  /** Unix ms. */
  date: number
  subject: string
  /** Ref decorations pointing at this commit (HEAD -> main, origin/main, tag: v1). */
  refs: string[]
}

export type GitLogResult = { ok: true; commits: GitCommit[] } | { ok: false; error: string }

export type GitCommitFile = {
  path: string
  insertions: number
  deletions: number
  /** True for binary files (numstat reports "-"). */
  binary: boolean
}

export type GitCommitDetail =
  | {
      ok: true
      sha: string
      shortSha: string
      author: string
      email: string
      date: number
      subject: string
      body: string
      refs: string[]
      files: GitCommitFile[]
      patch: string
      patchTruncated: boolean
    }
  | { ok: false; error: string }

export type GitBranch = {
  name: string
  current: boolean
  remote: boolean
  sha: string
  subject: string
  /** Unix ms of the tip commit. */
  date: number
  upstream: string
  ahead: number
  behind: number
}

export type GitBranchesResult = { ok: true; branches: GitBranch[] } | { ok: false; error: string }

export type GitStash = { ref: string; branch: string; subject: string; date: number }

export type GitStashesResult = { ok: true; stashes: GitStash[] } | { ok: false; error: string }

export type GitTag = { name: string; sha: string; subject: string; date: number }

export type GitTagsResult = { ok: true; tags: GitTag[] } | { ok: false; error: string }

export type GitOpResult = { ok: true } | { ok: false; error: string }

export type GitPatchResult = { ok: true; patch: string } | { ok: false; error: string }

export type WorkingDiff = {
  ok: boolean
  diff: string
  base: string
  branch: string
  error?: string
}

export type GitStatus = {
  ok: boolean
  branch: string
  ahead: number
  behind: number
  dirty: number
  upstream: boolean
}

export type StructuralDiffResult =
  | { ok: true; output: string }
  | { ok: false; reason: 'difft-missing' | 'binary' | 'fetch-failed' | 'error'; message?: string }
