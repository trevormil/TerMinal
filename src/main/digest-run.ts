import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as forge from './forge'
import { configPath } from './config-dir'
import { projectAreaPathForWrite } from './project-layout'
import { repoStateEnv } from './repo-state'

// Runs the /digest pipeline for an MR in the repo ROOT (not a worktree): the
// digest only reads source + writes artifacts under .TerMinal/reviews/, so there
// is no test/build contamination to isolate. Deterministic stages (diff fetch,
// chunk-diff) run inline; the codex pass + merge run as one tracked child
// process. Emits 'digest:status' so the renderer can spinner + auto-refresh.

export type DigestRunStatus = 'running' | 'done' | 'failed'
export type DigestRunState = {
  iid: number
  short: string
  status: DigestRunStatus
  startedAt: number
  endedAt?: number
  error?: string
}

const runs = new Map<string, DigestRunState>()
const key = (repoRoot: string, iid: number) => `${repoRoot}#${iid}`

let emit: ((channel: string, payload: unknown) => void) | null = null
export function onDigestEvent(fn: (channel: string, payload: unknown) => void): void {
  emit = fn
}
function fire(state: DigestRunState) {
  emit?.('digest:status', state)
}

export function digestStatus(repoRoot: string, iid: number): DigestRunState | null {
  return runs.get(key(repoRoot, iid)) ?? null
}

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

export async function startDigest(
  repoRoot: string,
  iid: number,
): Promise<{ ok: boolean; error?: string }> {
  if (!repoRoot) return { ok: false, error: 'no repo' }
  const k = key(repoRoot, iid)
  if (runs.get(k)?.status === 'running') return { ok: true }

  // Machinery lives in the globally-installed tm plugin; a repo-local copy
  // (pre-plugin bootstraps) still wins so old repos keep their pinned version.
  const pick = (repoRel: string, pluginRel: string): string => {
    const local = join(repoRoot, repoRel)
    return existsSync(local) ? local : configPath('plugin', pluginRel)
  }
  const chunkBin = pick('.claude/bin/chunk-diff', 'bin/chunk-diff')
  const mergeBin = pick('.claude/bin/merge-digest', 'bin/merge-digest')
  const promptTmpl = pick('.claude/skills/digest/prompt.md', 'skills/digest/prompt.md')
  if (!existsSync(chunkBin) || !existsSync(promptTmpl)) {
    return {
      ok: false,
      error: 'digest machinery not found (tm plugin not installed and repo has no local copy)',
    }
  }

  // Fresh diff at the CURRENT head (bypass any cached .diff.patch from an older sha).
  const raw = await forge.detailRaw(repoRoot, iid)
  if (!raw) return { ok: false, error: 'could not load MR from the forge' }
  const short = raw.headShort
  const base = raw.targetBranch || 'main'
  const diff = await forge.diff(repoRoot, iid)
  if (!diff || !diff.trim()) return { ok: false, error: 'forge returned an empty diff' }

  const dir = join(projectAreaPathForWrite(repoRoot, 'reviews'), String(iid))
  mkdirSync(dir, { recursive: true })
  const diffPath = join(dir, `${short}.diff.patch`)
  const scopedPath = join(dir, `${short}.scoped.diff`)
  const chunksPath = join(dir, `${short}.chunks.json`)
  const patchPath = join(dir, `${short}.digest-patch.json`)
  const promptPath = join(dir, `${short}.digest-prompt.txt`)
  const logPath = join(dir, `${short}.digest.log`)
  writeFileSync(diffPath, diff, 'utf8')

  const state: DigestRunState = { iid, short, status: 'running', startedAt: Date.now() }
  runs.set(k, state)
  fire(state)

  try {
    // Deterministic chunking (fast, inline).
    await run(
      chunkBin,
      [
        '--patch',
        diffPath,
        '--pr',
        `${repoRoot.split('/').pop()}#${iid}`,
        '--short',
        short,
        '--out',
        chunksPath,
        '--scoped-out',
        scopedPath,
        ...(existsSync(join(dir, 'findings.json'))
          ? ['--findings', join(dir, 'findings.json')]
          : []),
      ],
      repoRoot,
    )

    // Build the codex prompt from the repo's skill template (kept in sync with the skill).
    const prompt = readFileSync(promptTmpl, 'utf8')
      .replaceAll('{{PR}}', String(iid))
      .replaceAll('{{SHORT}}', short)
      .replaceAll('{{BASE}}', base)
      .replaceAll('{{HEAD}}', raw.headShort)
      .replaceAll('{{DIR}}', dir.startsWith(repoRoot) ? dir.slice(repoRoot.length + 1) : dir)
      .replaceAll(
        '{{DIFF_PATH}}',
        scopedPath.startsWith(repoRoot) ? scopedPath.slice(repoRoot.length + 1) : scopedPath,
      )
    writeFileSync(promptPath, prompt, 'utf8')

    // codex pass + deterministic merge, as one tracked child via the login shell
    // (so codex resolves on PATH). The speed levers match the skill.
    const cmd =
      `codex exec -s workspace-write -c model_reasoning_effort=low -C ${sh(repoRoot)} ` +
      `"$(cat ${sh(promptPath)})" < /dev/null && ` +
      `${sh(mergeBin)} --chunks ${sh(chunksPath)} --patch ${sh(patchPath)}`

    const shell = process.env.SHELL || '/bin/zsh'
    const child = spawn(shell, ['-l', '-c', cmd], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      // The digest skill writes its chunks next to the review artifact and
      // resolves that through $TERMINAL_REVIEWS_DIR. Without these the var is
      // unset inside codex and the artifact lands back in the repo.
      env: { ...process.env, ...repoStateEnv(repoRoot) },
    })
    const log: string[] = []
    child.stdout?.on('data', (d) => log.push(d.toString()))
    child.stderr?.on('data', (d) => log.push(d.toString()))
    child.on('close', (code) => {
      try {
        writeFileSync(logPath, log.join(''), 'utf8')
      } catch {
        /* best effort */
      }
      const ok = code === 0 && existsSync(chunksPath)
      const next: DigestRunState = {
        ...state,
        status: ok ? 'done' : 'failed',
        endedAt: Date.now(),
        error: ok ? undefined : `codex/merge exited ${code} — see ${logPath}`,
      }
      runs.set(k, next)
      fire(next)
    })
    return { ok: true }
  } catch (e) {
    const next: DigestRunState = {
      ...state,
      status: 'failed',
      endedAt: Date.now(),
      error: e instanceof Error ? e.message : String(e),
    }
    runs.set(k, next)
    fire(next)
    return { ok: false, error: next.error }
  }
}

function run(bin: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr?.on('data', (d) => (err += d.toString()))
    p.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${bin.split('/').pop()} exited ${code}: ${err.slice(-400)}`)),
    )
    p.on('error', reject)
  })
}
