// ── monitor ──────────────────────────────────────────────────────────────
// Manage the Monitoring subsystem's config from the CLI/scripts. The daemon
// (terminal-monitor) does the probing; this only edits ~/.config/TerMinal/
// monitors.json and triggers a one-off run.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { updateJsonListShared } from '../runner/state-io'
import { CFG, MONITOR_STATE_DIR, MONITORS_FILE, TERMINAL_BIN } from './env'

const MONITOR_TYPES = ['http', 'tls-cert', 'tcp', 'dns', 'command']

type StoredMonitor = {
  id: string
  name?: string
  type?: string
  enabled?: boolean
  [k: string]: unknown
}

function readMonitors(): StoredMonitor[] {
  try {
    const a = JSON.parse(readFileSync(MONITORS_FILE(), 'utf8'))
    return Array.isArray(a) ? a : []
  } catch {
    return []
  }
}

function writeMonitors(list: StoredMonitor[]): void {
  mkdirSync(CFG(), { recursive: true })
  updateJsonListShared<StoredMonitor>(MONITORS_FILE(), () => list)
}

export function monitorCli(args: string[]): void {
  const sub = args[0]
  const flag = (n: string): string | undefined =>
    args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
  const list = readMonitors()

  if (sub === 'list' || !sub) {
    for (const m of list) {
      let st = ''
      try {
        st = JSON.parse(readFileSync(join(MONITOR_STATE_DIR(), `${m.id}.json`), 'utf8')).status
      } catch {
        /* never checked yet */
      }
      console.log(
        `${m.enabled === false ? '○' : '●'} ${m.id}  [${m.type}]  ${st || '—'}  ${m.name}`,
      )
    }
    return
  }
  if (sub === 'status') {
    for (const m of list) {
      try {
        const s = JSON.parse(readFileSync(join(MONITOR_STATE_DIR(), `${m.id}.json`), 'utf8'))
        console.log(`${m.id}: ${s.status} — ${s.summary}`)
      } catch {
        console.log(`${m.id}: (no data yet)`)
      }
    }
    return
  }
  if (sub === 'add') {
    const type = flag('type')
    const name = flag('name') || flag('target')
    const target = flag('target')
    if (!MONITOR_TYPES.includes(type as string) || !target) {
      console.error(
        `usage: terminal-cli monitor add --type=<${MONITOR_TYPES.join('|')}> --target=<t> [--name=..] [--interval=60] [--group=..] [--on-failure=urgent|normal|low|off] [--config-json='{}']`,
      )
      process.exit(2)
    }
    const id = ((flag('id') || name || target) as string)
      .toLowerCase()
      .replace(/[^\w-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
    if (list.some((m) => m.id === id)) {
      console.error(`monitor "${id}" already exists`)
      process.exit(2)
    }
    let config: unknown = {}
    const cj = flag('config-json')
    if (cj)
      try {
        config = JSON.parse(cj)
      } catch {
        console.error('bad --config-json')
        process.exit(2)
      }
    list.push({
      id,
      name: name || id,
      type,
      target,
      intervalSec: Number(flag('interval')) || 60,
      enabled: true,
      group: flag('group') || undefined,
      notify: {
        onFailure: flag('on-failure') || 'urgent',
        onRecovery: flag('on-recovery') !== 'false',
        renotifyAfterSec: Number(flag('renotify')) || 3600,
        dailyDigest: flag('daily-digest') === 'true',
        digestHour: Number(flag('digest-hour')) || 9,
      },
      config,
    })
    writeMonitors(list)
    console.log(id)
    return
  }
  const id = args[1]
  if (sub === 'remove') {
    writeMonitors(list.filter((m) => m.id !== id))
    try {
      const p = join(MONITOR_STATE_DIR(), `${id}.json`)
      if (existsSync(p)) writeFileSync(p, '') // best-effort clear; daemon prunes
    } catch {
      /* the daemon prunes orphaned state on its next tick anyway */
    }
    console.log(`removed ${id}`)
    return
  }
  if (sub === 'enable' || sub === 'disable') {
    const m = list.find((x) => x.id === id)
    if (!m) {
      console.error(`monitor ${id} not found`)
      process.exit(1)
    }
    m.enabled = sub === 'enable'
    writeMonitors(list)
    console.log(`${id} ${m.enabled ? 'enabled' : 'disabled'}`)
    return
  }
  if (sub === 'check') {
    const bin = TERMINAL_BIN('terminal-monitor')
    try {
      execFileSync(bin, ['run', id], { stdio: 'inherit' })
    } catch {
      process.exit(1)
    }
    return
  }
  console.error('usage: terminal-cli monitor <list|status|add|remove|enable|disable|check>')
  process.exit(2)
}
