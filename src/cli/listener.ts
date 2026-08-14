// The automation inbox: a filesystem queue the app drains. `terminal-cli inbox
// enqueue` drops one JSON event into new/.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { LISTENER_ROOT } from './env'

function safeFileName(name: unknown): string {
  return (
    String(name || '')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/^-+|-+$/g, '') || randomUUID()
  )
}

type Flags = { _: string[]; [k: string]: any }

export function parseFlags(args: string[]): Flags {
  const out: Flags = { _: [] }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('--')) {
      out._.push(arg)
      continue
    }
    const eq = arg.indexOf('=')
    const key = arg
      .slice(2, eq > 0 ? eq : undefined)
      .replace(/-([a-z])/g, (_m, ch) => ch.toUpperCase())
    if (!key) continue
    if (eq > 0) out[key] = arg.slice(eq + 1)
    else if (args[i + 1] && !args[i + 1].startsWith('--')) out[key] = args[++i]
    else out[key] = true
  }
  return out
}

function readListenerEvent(args: string[]): any {
  const flags = parseFlags(args)
  const raw = flags._.join(' ').trim()
  if (!raw && (flags.source || flags.type)) {
    const action = flags.action
    const event: any = {
      id: flags.id,
      listenerId: flags.sourceId || flags.listener || flags.listenerId,
      listenerName: flags.sourceName || flags.name || flags.listenerName,
      source: flags.source,
      type: flags.type,
      title: flags.title,
      body: flags.body,
      repoRoot: flags.repoRoot || flags.repo,
      dedupeKey: flags.dedupeKey || flags.dedupe,
    }
    if (action) {
      if (action === 'activity')
        event.requestedAction = { kind: 'activity', title: flags.title, detail: flags.body }
      else if (action === 'file-ticket')
        event.requestedAction = {
          kind: 'file-ticket',
          title: flags.title,
          body: flags.body,
          type: flags.ticketType,
          priority: flags.priority,
        }
      else if (action === 'file-hitl')
        event.requestedAction = {
          kind: 'file-hitl',
          title: flags.title,
          action: flags.body || flags.prompt,
          detail: flags.detail,
        }
      else if (action === 'run-agent')
        event.requestedAction = {
          kind: 'run-agent',
          agentId: flags.agent || flags.agentId,
          engine: flags.engine,
          model: flags.model,
          mode: flags.mode || 'agent',
          prompt: flags.prompt,
        }
      else if (action === 'background-task')
        event.requestedAction = {
          kind: 'background-task',
          engine: flags.engine,
          model: flags.model,
          prompt: flags.prompt || flags.body || '',
        }
    }
    return event
  }
  return raw ? JSON.parse(raw) : JSON.parse(readFileSync(0, 'utf8'))
}

function listenerDirs(): string[] {
  return ['new', 'processing', 'done', 'failed', 'dead-letter']
}

function listenerStatus(): void {
  const counts = Object.fromEntries(
    listenerDirs().map((dir) => {
      try {
        return [
          dir,
          readdirSync(join(LISTENER_ROOT(), dir)).filter((f) => f.endsWith('.json')).length,
        ]
      } catch {
        return [dir, 0]
      }
    }),
  )
  console.log(JSON.stringify({ inboxDir: LISTENER_ROOT(), counts }, null, 2))
}

function listenerExample(): void {
  console.log(
    JSON.stringify(
      {
        listenerId: 'local-script:repo-health',
        listenerName: 'Local repo health',
        source: 'local-script',
        type: 'automation.requested',
        title: 'Run repo health',
        repoRoot: process.cwd(),
        dedupeKey: `local-script:repo-health:${process.cwd()}`,
        requestedAction: { kind: 'run-agent', agentId: 'health', engine: 'codex', mode: 'agent' },
      },
      null,
      2,
    ),
  )
}

export function listenerCommand(sub: string | undefined, args: string[]): void {
  if (sub === 'dir') {
    console.log(LISTENER_ROOT())
    return
  }
  if (sub === 'status') {
    listenerStatus()
    return
  }
  if (sub === 'example') {
    listenerExample()
    return
  }
  if (sub !== 'enqueue') {
    console.error('usage: terminal-cli inbox <enqueue|status|dir|example> [json|flags]')
    process.exit(2)
  }
  let event: any = {}
  try {
    event = readListenerEvent(args)
  } catch (e) {
    console.error(`terminal-cli inbox enqueue: invalid JSON: ${(e as Error).message}`)
    process.exit(2)
  }
  if (!event || typeof event !== 'object') {
    console.error('terminal-cli inbox enqueue: event must be a JSON object')
    process.exit(2)
  }
  if (!event.source || !event.type) {
    console.error('terminal-cli inbox enqueue: source and type are required')
    process.exit(2)
  }
  mkdirSync(join(LISTENER_ROOT(), 'new'), { recursive: true })
  const id = event.id || randomUUID()
  const path = join(LISTENER_ROOT(), 'new', `${safeFileName(id)}.json`)
  writeFileSync(
    path,
    JSON.stringify(
      { ...event, id, createdAt: event.createdAt || new Date().toISOString() },
      null,
      2,
    ),
  )
  console.log(path)
}
