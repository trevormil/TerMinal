import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalCheck, LocalCheckPlan, LocalCheckResult } from '../shared/types/local-checks'

export function selectChecks(manifest: unknown, installed: string[]): LocalCheck[] {
  const scripts = (manifest as { scripts?: Record<string, unknown> } | null)?.scripts
  const checks: LocalCheck[] = []
  for (const id of ['check', 'typecheck', 'lint']) {
    const detail = scripts?.[id]
    if (typeof detail === 'string' && detail.trim())
      checks.push({ id: `script:${id}`, executable: 'bun', args: ['run', id], detail })
  }
  if (!checks.some((c) => c.id === 'script:typecheck') && installed.includes('tsc'))
    checks.push({
      id: 'tsc',
      executable: './node_modules/.bin/tsc',
      args: ['--noEmit', '--pretty', 'false'],
      detail: 'TypeScript check without emitting files',
    })
  if (!checks.some((c) => c.id === 'script:lint') && installed.includes('eslint'))
    checks.push({
      id: 'eslint',
      executable: './node_modules/.bin/eslint',
      args: ['.', '--format', 'stylish'],
      detail: 'ESLint diagnostics without --fix',
    })
  return checks
}

export function discoverChecks(root: string): LocalCheckPlan {
  if (!root)
    return {
      root,
      checks: [],
      error: 'Not a local git repo. Open a local repository to run checks.',
    }
  let manifest: unknown = {}
  try {
    if (existsSync(join(root, 'package.json')))
      manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  } catch {
    return { root, checks: [], error: 'Could not read package.json. Fix it and reopen Run check.' }
  }
  const checks = selectChecks(
    manifest,
    ['tsc', 'eslint'].filter((name) => existsSync(join(root, 'node_modules', '.bin', name))),
  )
  return {
    root,
    checks,
    error: checks.length
      ? undefined
      : 'No checker configured. Add a check, typecheck or lint package script, or install TypeScript / ESLint locally.',
  }
}

export function checkResult(code: number | null, stdout: string, stderr: string): LocalCheckResult {
  // Checker output is text, not terminal control input.
  const clean = [stdout, stderr]
    .filter(Boolean)
    .join('\n')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .trim()
  const output = clean.length > 32000 ? `${clean.slice(0, 32000)}\n[Output truncated]` : clean
  return {
    status: code === 0 ? 'passed' : code === null ? 'error' : 'failed',
    summary:
      code === 0
        ? 'Check passed'
        : code === null
          ? 'Check could not complete (timeout, output limit or launch error)'
          : `Check failed (exit ${code})`,
    output,
  }
}

const running = new Set<string>()
export async function runLocalCheck(
  root: string,
  approved: LocalCheckPlan,
  id: string,
): Promise<LocalCheckResult> {
  const plan = discoverChecks(root)
  if (plan.error || JSON.stringify(plan) !== JSON.stringify(approved))
    return checkResult(
      null,
      '',
      plan.error || 'Workspace or checks changed. Reopen Run check and review the command again.',
    )
  const check = plan.checks.find((c) => c.id === id)
  if (!check) return checkResult(null, '', 'Choose a configured check.')
  if (running.has(root)) return checkResult(null, '', 'A check is already running for this repo.')
  running.add(root)
  try {
    return await new Promise<LocalCheckResult>((resolve) => {
      const child = spawn(check.executable, check.args, {
        cwd: root,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      })
      let stdout = ''
      let stderr = ''
      let bytes = 0
      let stopped = ''
      const killGroup = () => {
        if (!child.pid) return
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          /* Process group already exited. */
        }
      }
      const timer = setTimeout(() => {
        stopped = 'Check exceeded the two-minute limit.'
        killGroup()
      }, 120000)
      const collect = (chunk: string, isError: boolean) => {
        if (stopped) return
        bytes += Buffer.byteLength(chunk)
        if (bytes > 512000) {
          stopped = 'Check exceeded the output limit.'
          killGroup()
          return
        }
        if (isError) stderr += chunk
        else stdout += chunk
      }
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => collect(chunk, false))
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => collect(chunk, true))
      child.on('error', (error) => {
        clearTimeout(timer)
        killGroup()
        resolve(checkResult(null, stdout, error.message))
      })
      child.on('exit', killGroup)
      child.on('close', (code) => {
        clearTimeout(timer)
        killGroup()
        resolve(
          checkResult(stopped ? null : code, stdout, [stopped, stderr].filter(Boolean).join('\n')),
        )
      })
    })
  } finally {
    running.delete(root)
  }
}
