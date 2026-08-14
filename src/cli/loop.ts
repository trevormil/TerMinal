// loop — the roles' durable transport (protocol.md option 2) + a read surface.
// Reads/writes the loop's on-disk state; the heavy lifting (create/step/spawn)
// stays in the app. Loop state lives in the repo's SIDECAR (loops/<id>/),
// resolved per loop so one already running out of a legacy in-repo
// .TerMinal/loops dir keeps working.
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { statePathSticky } from '../runner/repo-state'
import { LOOPS_FILE } from './env'
import { localDay } from './tickets'

function gitOut(root: string, args: string[]): string {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

export function loopCommand(sub: string | undefined, rest: string[]): void {
  // The app spawns loop roles with cwd = the GENERATOR WORKTREE and injects
  // TERMINAL_REPO = the source repo; resolving from cwd would key a phantom
  // sidecar off the worktree and split the loop's state. Sticky resolution
  // matches the app: a legacy in-repo loop keeps finishing where it started.
  const loopRoot =
    process.env.TERMINAL_REPO ||
    gitOut(process.cwd(), ['rev-parse', '--show-toplevel']) ||
    process.cwd()
  const loopDir = (id: string): string => statePathSticky(loopRoot, join('loops', id))
  const usage = (): never => {
    console.error(
      'usage: terminal-cli loop <list | event <id> <role> <kind> [summary] [detail] | log <id> <line> | state <id>>',
    )
    process.exit(2)
  }
  if (sub === 'list') {
    let loops: any[] = []
    if (existsSync(LOOPS_FILE())) {
      try {
        loops = JSON.parse(readFileSync(LOOPS_FILE(), 'utf8'))
      } catch {
        /* empty */
      }
    }
    if (!loops.length) return console.log('(no loops)')
    for (const l of loops) console.log(`${l.id}  [${l.phase}]  iter ${l.iteration}  ${l.goal}`)
    return
  }
  const id = rest[0]
  if (!id) usage()
  const dir = loopDir(id)
  if (sub === 'event') {
    const [, role, kind, summary, detail] = rest
    if (!role || !kind) usage()
    mkdirSync(dir, { recursive: true })
    const ev = {
      loopId: id,
      role,
      kind,
      summary: summary || '',
      ...(detail ? { detail } : {}),
      createdAt: new Date().toISOString(),
    }
    appendFileSync(join(dir, 'events.jsonl'), JSON.stringify(ev) + '\n')
    console.log(join(dir, 'events.jsonl'))
    return
  }
  if (sub === 'log') {
    const line = rest.slice(1).join(' ')
    if (!line) usage()
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'log.md'), `## [${localDay()}] ${line}\n`)
    return
  }
  if (sub === 'state') {
    const p = join(dir, 'progress.md')
    console.log(existsSync(p) ? readFileSync(p, 'utf8') : '(no progress.md)')
    return
  }
  usage()
}
