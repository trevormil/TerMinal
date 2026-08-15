import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HOOK_TIMEOUT_SECONDS,
  globalHookStatus,
  installGlobalHook,
  uninstallGlobalHook,
} from './global-hook'

type Fixture = { settingsPath: string; command: string; read: () => Record<string, unknown> }

function fixture(settings?: unknown): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'terminal-global-hook-'))
  const settingsPath = join(dir, 'settings.json')
  if (settings !== undefined) {
    writeFileSync(
      settingsPath,
      typeof settings === 'string' ? settings : JSON.stringify(settings, null, 2),
    )
  }
  const command = join(dir, 'remote-check.sh')
  writeFileSync(command, '#!/bin/sh\nexit 0\n')
  return {
    settingsPath,
    command,
    read: () => JSON.parse(readFileSync(settingsPath, 'utf8')),
  }
}

describe('installGlobalHook', () => {
  it('creates the settings file with the Stop hook and reports what it wrote', () => {
    const f = fixture()
    const result = installGlobalHook({ settingsPath: f.settingsPath, command: f.command })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changed).toBe(true)
    expect(result.installed).toBe(true)
    expect(result.message).toContain(f.settingsPath)
    expect(result.message).toContain(f.command)
    expect(f.read()).toEqual({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: f.command, timeout: HOOK_TIMEOUT_SECONDS }] }],
      },
    })
  })

  it('is idempotent — a second install writes nothing and says so', () => {
    const f = fixture()
    installGlobalHook({ settingsPath: f.settingsPath, command: f.command })
    const before = readFileSync(f.settingsPath, 'utf8')
    const again = installGlobalHook({ settingsPath: f.settingsPath, command: f.command })
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.changed).toBe(false)
    expect(again.installed).toBe(true)
    expect(readFileSync(f.settingsPath, 'utf8')).toBe(before)
  })

  it('keeps every other setting and every other Stop hook', () => {
    const other = { hooks: [{ type: 'command', command: '/opt/telegram-bridge.sh' }] }
    const f = fixture({
      model: 'opus',
      permissions: { deny: ['Bash(rm:*)'] },
      hooks: { Stop: [other], PreToolUse: [{ matcher: 'Bash', hooks: [] }] },
    })
    installGlobalHook({ settingsPath: f.settingsPath, command: f.command })
    const saved = f.read() as {
      model: string
      permissions: unknown
      hooks: { Stop: unknown[]; PreToolUse: unknown[] }
    }
    expect(saved.model).toBe('opus')
    expect(saved.permissions).toEqual({ deny: ['Bash(rm:*)'] })
    expect(saved.hooks.PreToolUse).toEqual([{ matcher: 'Bash', hooks: [] }])
    // Ours is appended; the existing group is untouched, not merged into.
    expect(saved.hooks.Stop).toEqual([
      other,
      { hooks: [{ type: 'command', command: f.command, timeout: HOOK_TIMEOUT_SECONDS }] },
    ])
  })

  it('refuses — without writing — when the settings file is not readable JSON', () => {
    const f = fixture('{ this is not json')
    const result = installGlobalHook({ settingsPath: f.settingsPath, command: f.command })
    expect(result.ok).toBe(false)
    // The user's file survives verbatim: a broken settings.json must never be
    // silently replaced by one containing only our hook.
    expect(readFileSync(f.settingsPath, 'utf8')).toBe('{ this is not json')
  })

  it('refuses to register a hook script that is not on disk', () => {
    const f = fixture()
    const result = installGlobalHook({
      settingsPath: f.settingsPath,
      command: join(f.command, '..', 'missing.sh'),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('missing.sh')
  })
})

describe('uninstallGlobalHook', () => {
  it('removes only our hook and prunes the emptied structure', () => {
    const f = fixture({ model: 'opus' })
    installGlobalHook({ settingsPath: f.settingsPath, command: f.command })
    const result = uninstallGlobalHook({ settingsPath: f.settingsPath, command: f.command })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changed).toBe(true)
    expect(result.installed).toBe(false)
    expect(f.read()).toEqual({ model: 'opus' })
  })

  it('leaves another tool’s Stop hook in place', () => {
    const f = fixture({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: '/opt/telegram-bridge.sh' }] }] },
    })
    installGlobalHook({ settingsPath: f.settingsPath, command: f.command })
    uninstallGlobalHook({ settingsPath: f.settingsPath, command: f.command })
    expect(f.read()).toEqual({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: '/opt/telegram-bridge.sh' }] }] },
    })
  })

  it('is a no-op when the hook was never installed', () => {
    const f = fixture({ model: 'opus' })
    const result = uninstallGlobalHook({ settingsPath: f.settingsPath, command: f.command })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changed).toBe(false)
    expect(f.read()).toEqual({ model: 'opus' })
  })
})

describe('globalHookStatus', () => {
  it('reports installed state and whether the script exists', () => {
    const f = fixture()
    expect(globalHookStatus({ settingsPath: f.settingsPath, command: f.command })).toEqual({
      installed: false,
      settingsPath: f.settingsPath,
      command: f.command,
      commandExists: true,
    })
    installGlobalHook({ settingsPath: f.settingsPath, command: f.command })
    expect(globalHookStatus({ settingsPath: f.settingsPath, command: f.command }).installed).toBe(
      true,
    )
  })

  it('never resolves to the real ~/.claude when TERMINAL_CLAUDE_DIR is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'terminal-claude-dir-'))
    const before = process.env.TERMINAL_CLAUDE_DIR
    process.env.TERMINAL_CLAUDE_DIR = dir
    try {
      expect(globalHookStatus().settingsPath).toBe(join(dir, 'settings.json'))
    } finally {
      if (before === undefined) delete process.env.TERMINAL_CLAUDE_DIR
      else process.env.TERMINAL_CLAUDE_DIR = before
    }
  })
})
