import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'

// Write via temp-file + rename. Both targets — ~/.claude.json (Claude Code's
// live, auth-bearing state) and ~/.codex/config.toml (holds unrelated
// projects/hooks/features blocks) — are rewritten whole; a plain writeFileSync
// truncates-then-writes, so a crash/kill mid-write can leave them empty or
// partial, destroying config we don't own. rename is atomic within a
// filesystem, and the temp sits in the same dir so the rename stays intra-fs.
function atomicWrite(path: string, data: string): void {
  const tmp = `${path}.terminal-tmp-${process.pid}`
  try {
    writeFileSync(tmp, data)
    renameSync(tmp, path)
  } catch (e) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      /* best effort */
    }
    throw e
  }
}

// Auto-register terminal-mcp-server with Claude Code and Codex CLI so every
// session — TerMinal-spawned or ad-hoc — discovers the harness tools natively
// (no per-repo .mcp.json, no operator config step). Runs at TerMinal startup
// after the binary is installed under ~/.config/TerMinal/bin.
//
// Both writes are idempotent: present-with-same-args → no-op; absent → patch;
// present-with-different-args → patch (covers a stale registration after a
// bun-path change or repo move). Safe to call on every boot.

const SERVER_NAME = 'terminal-harness'

function resolveBun(): string {
  try {
    const out = execFileSync('/usr/bin/which', ['bun'], { encoding: 'utf8' }).trim()
    if (out) return out
  } catch {
    /* fall through */
  }
  // Common installer locations as fallbacks (in priority order).
  const guesses = [join(homedir(), '.bun', 'bin', 'bun'), '/opt/homebrew/bin/bun', '/usr/local/bin/bun']
  for (const g of guesses) if (existsSync(g)) return g
  return 'bun' // last-ditch: hope PATH carries it (rare on cron-spawned shells)
}

function mcpServerPath(): string {
  return join(homedir(), '.config', 'TerMinal', 'bin', 'terminal-mcp-server')
}

// ---- Claude Code (~/.claude.json) -----------------------------------------
// Shape: { ..., "mcpServers": { "<name>": { "command": ..., "args": [...] } } }
export function registerWithClaude(): { ok: boolean; action: string; error?: string } {
  const path = join(homedir(), '.claude.json')
  const serverPath = mcpServerPath()
  if (!existsSync(serverPath)) return { ok: false, action: 'skip', error: `mcp server not installed at ${serverPath}` }
  const desired = { command: resolveBun(), args: [serverPath] }

  let json: Record<string, unknown> = {}
  if (existsSync(path)) {
    try {
      json = JSON.parse(readFileSync(path, 'utf8'))
    } catch (e) {
      return { ok: false, action: 'skip', error: `~/.claude.json unreadable: ${(e as Error).message}` }
    }
  }
  // The mcpServers field can ship as an object OR an empty array depending on
  // how Claude Code initialized it. Normalize to object before we patch.
  const raw = (json as { mcpServers?: unknown }).mcpServers
  const servers: Record<string, unknown> =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const existing = servers[SERVER_NAME] as { command?: string; args?: string[] } | undefined
  const sameCmd = existing?.command === desired.command
  const sameArgs = Array.isArray(existing?.args) && existing!.args.length === 1 && existing!.args[0] === serverPath
  if (existing && sameCmd && sameArgs) return { ok: true, action: 'already-registered' }
  servers[SERVER_NAME] = desired
  ;(json as Record<string, unknown>).mcpServers = servers
  try {
    atomicWrite(path, JSON.stringify(json, null, 2))
    return { ok: true, action: existing ? 'updated' : 'added' }
  } catch (e) {
    return { ok: false, action: 'write-failed', error: (e as Error).message }
  }
}

// ---- Codex CLI (~/.codex/config.toml) -------------------------------------
// Shape: TOML block [mcp_servers.<name>] with command = "..." + args = [...]
// We don't pull in a TOML parser for one block — match by literal heading +
// command/args lines; rewrite the block atomically. The codex config has
// many other unrelated blocks (projects, hooks, features), so we splice
// inside the existing file rather than rewriting it.
export function registerWithCodex(): { ok: boolean; action: string; error?: string } {
  const path = join(homedir(), '.codex', 'config.toml')
  const serverPath = mcpServerPath()
  if (!existsSync(serverPath)) return { ok: false, action: 'skip', error: `mcp server not installed at ${serverPath}` }
  const bunPath = resolveBun()
  const heading = `[mcp_servers.${SERVER_NAME}]`
  const block = `${heading}\ncommand = ${JSON.stringify(bunPath)}\nargs = [${JSON.stringify(serverPath)}]\n`

  let text = ''
  if (existsSync(path)) {
    try {
      text = readFileSync(path, 'utf8')
    } catch (e) {
      return { ok: false, action: 'skip', error: `codex config unreadable: ${(e as Error).message}` }
    }
  }

  // Find the existing block by heading. A TOML block ends at the next [...]
  // heading or EOF. We splice in-place so unrelated state stays intact.
  const headingIdx = text.indexOf(heading)
  if (headingIdx >= 0) {
    // Find the next heading after ours, OR EOF.
    const restStart = headingIdx + heading.length
    const nextHeadingMatch = text.slice(restStart).search(/\n\[/)
    const blockEnd = nextHeadingMatch >= 0 ? restStart + nextHeadingMatch + 1 : text.length
    const existing = text.slice(headingIdx, blockEnd).trim()
    const desired = block.trim()
    if (existing === desired) return { ok: true, action: 'already-registered' }
    text = text.slice(0, headingIdx) + block + text.slice(blockEnd)
  } else {
    // Append. Ensure exactly one blank line of separation if the file is
    // non-empty and doesn't already end in a newline.
    if (text && !text.endsWith('\n')) text += '\n'
    if (text && !text.endsWith('\n\n')) text += '\n'
    text += block
  }

  try {
    atomicWrite(path, text)
    return { ok: true, action: headingIdx >= 0 ? 'updated' : 'added' }
  } catch (e) {
    return { ok: false, action: 'write-failed', error: (e as Error).message }
  }
}

export function registerMcpEverywhere(): { claude: ReturnType<typeof registerWithClaude>; codex: ReturnType<typeof registerWithCodex> } {
  return {
    claude: registerWithClaude(),
    codex: registerWithCodex(),
  }
}
