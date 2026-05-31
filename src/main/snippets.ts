import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export type PromptSnippet = {
  id: string
  title: string
  prompt: string
  description?: string
  group?: string
}

type SnippetFile = {
  version?: number
  snippets?: unknown
}

const CFG = join(homedir(), '.config', 'TerMinal')
const GLOBAL_FILE = join(CFG, 'snippets.json')
const REPO_FILE = '.terminal/snippets.json'

const BUILT_INS: PromptSnippet[] = [
  {
    id: 'continue',
    title: 'Looks good. Continue',
    prompt: 'Looks good to me. Continue.',
    group: 'Common',
  },
  {
    id: 'status',
    title: 'Status',
    prompt: 'Give me a concise status update: what changed, what is left, and whether anything is blocked.',
    group: 'Common',
  },
  {
    id: 'wrap-up',
    title: 'Wrap up',
    prompt: 'Finish the current task, run the relevant checks, commit if appropriate, and summarize the result.',
    group: 'Common',
  },
  {
    id: 'tests',
    title: 'Run checks',
    prompt: 'Run the relevant typecheck/tests for this repo, fix any failures caused by the current work, and report the final result.',
    group: 'Common',
  },
]

function readSnippetFile(path: string): PromptSnippet[] {
  try {
    if (!existsSync(path)) return []
    const json = JSON.parse(readFileSync(path, 'utf8')) as SnippetFile
    if (!Array.isArray(json.snippets)) return []
    return json.snippets
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((x) => ({
        id: String(x.id || '').trim(),
        title: String(x.title || '').trim(),
        prompt: String(x.prompt || '').trim(),
        description: typeof x.description === 'string' ? x.description : undefined,
        group: typeof x.group === 'string' ? x.group : undefined,
      }))
      .filter((x) => x.id && x.title && x.prompt)
  } catch {
    return []
  }
}

function ensureGlobalFile(): void {
  if (existsSync(GLOBAL_FILE)) return
  mkdirSync(CFG, { recursive: true })
  writeFileSync(
    GLOBAL_FILE,
    JSON.stringify(
      {
        version: 1,
        snippets: BUILT_INS,
      },
      null,
      2,
    ),
  )
}

export function listPromptSnippets(repoRoot: string): {
  snippets: PromptSnippet[]
  globalPath: string
  repoPath: string
} {
  ensureGlobalFile()
  const repoPath = repoRoot ? join(repoRoot, REPO_FILE) : ''
  const byId = new Map<string, PromptSnippet>()
  for (const s of BUILT_INS) byId.set(s.id, s)
  for (const s of readSnippetFile(GLOBAL_FILE)) byId.set(s.id, s)
  for (const s of repoPath ? readSnippetFile(repoPath) : []) byId.set(s.id, s)
  return { snippets: [...byId.values()], globalPath: GLOBAL_FILE, repoPath }
}
