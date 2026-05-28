import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { telegramControlEnabled } from './settings'
import { readAgents, runAgent, listRuns, cancelRun } from './agents'
import { readPersonas } from './personas'
import { parseCommand, classifyRunArgs, parsePollLine } from './telegram-parse'

// Two-way AFK control over the /notify Telegram bridge: the user texts the bot
// from their phone to launch/cancel/inspect agent runs. telegram-poll.sh only
// returns messages from the configured chat_id, so that fixed chat is the auth
// boundary — the bot acts on no one else.
const POLL = join(homedir(), '.claude', 'bin', 'telegram-poll.sh')
const NOTIFY = join(homedir(), '.claude', 'bin', 'telegram-notify.sh')
const STATUS_EMOJI: Record<string, string> = {
  running: '⏳',
  done: '✅',
  failed: '⛔',
  canceled: '⏹',
  interrupted: '⚠️',
}

type RepoCtx = { label: string; repoRoot: string }
let getRepos: () => RepoCtx[] = () => []
let getActive: () => RepoCtx | null = () => null

/** Wire in how to enumerate target repos (from the terminal's open sessions). */
export function configureTelegramControl(opts: { repos: () => RepoCtx[]; active: () => RepoCtx | null }) {
  getRepos = opts.repos
  getActive = opts.active
}

function reply(text: string) {
  if (!existsSync(NOTIFY)) return
  execFile(NOTIFY, [text], () => {})
}

let enabledAt = 0
/** Called when the control toggle flips (and at startup if already on). Drains
 *  the backlog so we don't replay pre-enable messages, and acks when asked. */
export function markTelegramControlEnabled(on: boolean, announce = true) {
  if (on) {
    enabledAt = Date.now()
    if (existsSync(POLL)) execFile(POLL, () => announce && reply('🤖 Remote control on. Send /help.'))
    else if (announce) reply('Remote control on, but the Telegram poll bridge is not installed.')
  } else if (announce) {
    reply('Remote control off.')
  }
}

let lastRunIds: string[] = [] // for /cancel <n> indexed off the last /runs

function resolveRepo(token?: string): RepoCtx | null {
  const repos = getRepos()
  if (token) {
    const t = token.replace(/^@/, '').toLowerCase()
    return repos.find((r) => r.label.toLowerCase().includes(t)) || null
  }
  return getActive() || repos[0] || null
}

const short = (root: string) => root.split('/').pop() || root

function cmdHelp() {
  reply(
    [
      '🤖 Gauntlet Terminal — AFK control',
      '',
      '/runs — active + recent runs',
      '/run <agent> [codex|claude] [persona] [pipeline] [@repo]',
      '/agents [@repo] — list agents for a repo',
      '/repos — open repos (run targets)',
      '/cancel <n> — cancel run #n from /runs',
      '/status — overview',
    ].join('\n'),
  )
}

function cmdRepos() {
  const repos = getRepos()
  if (!repos.length) return reply('No open sessions — open one in the terminal first.')
  const active = getActive()
  reply(
    'Repos:\n' +
      repos
        .map((r) => `• ${r.label}${active && r.repoRoot === active.repoRoot ? ' (active)' : ''}`)
        .join('\n'),
  )
}

function cmdAgents(repoToken?: string) {
  const repo = resolveRepo(repoToken)
  if (!repo) return reply('No repo — /repos to see options or open a session.')
  reply(`Agents · ${repo.label}:\n` + readAgents(repo.repoRoot).map((a) => `• ${a.id} — ${a.title}`).join('\n'))
}

function cmdRuns() {
  const runs = listRuns().slice(0, 8)
  if (!runs.length) return reply('No runs yet.')
  lastRunIds = runs.map((r) => r.id)
  reply(
    'Runs:\n' +
      runs
        .map((r, i) => `${i + 1}. ${STATUS_EMOJI[r.status] || ''} ${r.agentTitle} · ${short(r.repoRoot)} (${r.status})`)
        .join('\n'),
  )
}

function cmdStatus() {
  const running = listRuns().filter((r) => r.status === 'running')
  const repos = getRepos()
  reply(
    [
      `📊 ${running.length} running · ${repos.length} open repo(s)`,
      ...running.map((r) => `⏳ ${r.agentTitle} · ${short(r.repoRoot)}`),
    ].join('\n'),
  )
}

function cmdRun(args: string[]) {
  if (!args.length) return reply('Usage: /run <agent> [codex|claude] [persona] [pipeline] [@repo]')
  const { agentId, engine, pipeline, repoToken, personaCandidates } = classifyRunArgs(args)
  let persona = ''
  const repo = resolveRepo(repoToken)
  if (!repo) return reply('No repo — /repos to see options or open a session.')
  if (!readAgents(repo.repoRoot).some((a) => a.id === agentId))
    return reply(`Unknown agent "${agentId}". /agents to list.`)
  if (personaCandidates.length) {
    const ids = new Set(readPersonas(repo.repoRoot).map((p) => p.id))
    const match = personaCandidates.find((p) => ids.has(p))
    if (!match) return reply(`Unknown persona "${personaCandidates.join(' ')}". Valid: ${[...ids].join(', ')}`)
    persona = match
  }
  const r = runAgent(repo.repoRoot, agentId, engine, persona, pipeline)
  if ('error' in r) return reply(`⛔ ${r.error}`)
  reply(
    `✅ Spun out ${r.agentTitle} · ${engine}${persona ? ` · ${persona}` : ''}` +
      `${pipeline !== 'single' ? ` · ${pipeline}` : ''} on ${repo.label}.`,
  )
}

function cmdCancel(args: string[]) {
  const n = parseInt(args[0] || '', 10)
  if (!n || n < 1) return reply('Usage: /cancel <n> (the number from /runs)')
  const id = lastRunIds[n - 1]
  if (!id) return reply('No such run # — send /runs first.')
  reply(cancelRun(id) ? `⏹ Canceled run #${n}.` : `Run #${n} is not running.`)
}

function handle(text: string) {
  const { cmd, args } = parseCommand(text)
  switch (cmd) {
    case '/help':
    case '/start':
      return cmdHelp()
    case '/repos':
      return cmdRepos()
    case '/agents':
      return cmdAgents(args[0])
    case '/runs':
      return cmdRuns()
    case '/run':
      return cmdRun(args)
    case '/cancel':
      return cmdCancel(args)
    case '/status':
      return cmdStatus()
    default:
      return reply(`Unknown command ${cmd}. Send /help.`)
  }
}

let polling = false
/** One poll cycle — fetch new inbound messages and dispatch any commands.
 *  No-ops cheaply when control is off, so it's safe to call on a fixed timer. */
export function pollTelegramOnce() {
  if (polling || !telegramControlEnabled() || !existsSync(POLL)) return
  polling = true
  execFile(POLL, { timeout: 15_000, encoding: 'utf8' }, (err, stdout) => {
    polling = false
    if (err || !stdout) return
    for (const line of stdout.split('\n')) {
      const cmd = parsePollLine(line, enabledAt)
      if (cmd) handle(cmd)
    }
  })
}
