import { test, expect } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

// ~/.claude.json is Claude Code's live, auth-bearing state. The registrar
// rewrites the whole file, so it must preserve every unrelated key — and via
// atomicWrite (temp+rename) the on-disk result must always be valid JSON.
// Run in a child process with HOME set at startup (os.homedir() reads it then),
// which both makes the override reliable and guarantees we never touch the real
// ~/.claude.json.
test('registerWithClaude preserves unrelated ~/.claude.json state and adds the server', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'terminal-mcp-')))
  try {
    mkdirSync(join(home, '.config', 'TerMinal', 'bin'), { recursive: true })
    writeFileSync(join(home, '.config', 'TerMinal', 'bin', 'terminal-mcp-server'), '#!/bin/sh\n')
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({
        authToken: 'keep-me',
        projects: { a: 1 },
        mcpServers: { other: { command: 'x', args: [] } },
      }),
    )

    const mod = resolve(import.meta.dir, 'mcp-register.ts')
    const out = execFileSync(
      'bun',
      [
        '-e',
        `import { registerWithClaude } from ${JSON.stringify(mod)}; console.log(JSON.stringify(registerWithClaude()))`,
      ],
      { env: { ...process.env, HOME: home }, encoding: 'utf8' },
    )
    expect(JSON.parse(out.trim()).ok).toBe(true)

    const json = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'))
    expect(json.authToken).toBe('keep-me') // unrelated auth state preserved
    expect(json.projects).toEqual({ a: 1 })
    expect(json.mcpServers.other).toBeDefined() // sibling MCP server preserved
    expect(json.mcpServers['terminal-harness']).toBeDefined() // ours added
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
