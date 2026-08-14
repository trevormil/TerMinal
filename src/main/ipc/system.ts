// OS-integration IPC (ticket 0122 index.ts decomposition) — the handlers that
// hand something to macOS: the directory picker, the scratch workspace, the
// MCP registry install, "open in browser/editor", the clipboard, and the
// Cursor model catalog.
//
// Two of them are security-relevant and keep their guards verbatim:
// `open:in-browser` runs the same scheme gate as shell.openExternal, because
// `open -a <App> <target>` is simply a second way to reach an OS protocol
// handler; `open:in-editor` constrains renderer-supplied paths to the roots the
// UI legitimately surfaces.

import { clipboard, dialog, shell, BrowserWindow } from 'electron'
import { spawn as cpSpawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { handle } from '../typed-ipc'
import { configPath, terminalConfigDir } from '../config-dir'
import { listCursorModels } from '../cursor-models'
import { openExternalSafe } from '../open-external'
import { repoRootOf } from '../repo'
import { resolveWithinAny } from '../path-guard'
import { isExternallyOpenableUrl } from '../../shared/url-safety'
import {
  resolvedBrowserApp,
  resolvedEditorApp,
  resolvedProjectsDir,
  resolvedWorktreesDir,
} from '../settings'
import { type WorkspaceDaemon } from '../workspace-daemon'

export type SystemIpcDeps = {
  /** The app window, for the modal directory picker and the fullscreen query. */
  window(): BrowserWindow | null
  cur(): { cwd: string; sessionId: string }
  activeDaemon(): WorkspaceDaemon
}

export function registerSystemIpc(deps: SystemIpcDeps): void {
  handle('dialog:pickDir', async () => {
    const r = await dialog.showOpenDialog(deps.window()!, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: homedir(),
    })
    return r.canceled ? null : r.filePaths[0]
  })
  handle('window:is-fullscreen', () => deps.window()?.isFullScreen() ?? false)
  // ---- scratch workspace (throwaway, repo-less sessions) ----
  // One app-owned dir under the existing TerMinal config root — persistent
  // (unlike /tmp), out of the way (unlike ~), and not a git repo so repo-scoped
  // tabs/widgets stay off. All scratch sessions share it → one "scratch"
  // workspace grouping.
  handle('scratch:dir', () => {
    const dir = configPath('scratch')
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      /* already exists / race */
    }
    return dir
  })
  // Cursor's live model catalog (incl. the `auto` entry point for Cursor
  // Router). Empty when the CLI is missing or not logged in — the renderer then
  // keeps the static catalog.
  handle('cursor:models', () => listCursorModels())
  handle('open:external', (_e, url: string) => openExternalSafe(url))
  // Reveal ~/.config/TerMinal/ in Finder. Power-user QoL for editing
  // schedules.json, settings.json, or per-(repo, agent) state sidecars by hand.
  handle('open:config-dir', () => shell.openPath(terminalConfigDir()))

  // Install the MCP server entry into ~/.claude/mcp.json (and ~/.codex's
  // equivalent if it exists). Read-only, stdio transport. Idempotent —
  // re-running just updates the binary path.
  handle('mcp:install', () => {
    const binPath = configPath('bin', 'terminal-mcp-server')
    if (!existsSync(binPath)) {
      return { error: `terminal-mcp-server not installed at ${binPath}` }
    }
    const installed: string[] = []
    // Claude Code: ~/.claude/mcp.json (per Anthropic CLI docs)
    try {
      const claudeMcp = join(homedir(), '.claude', 'mcp.json')
      let cfg: any = {}
      if (existsSync(claudeMcp)) {
        try {
          cfg = JSON.parse(readFileSync(claudeMcp, 'utf8'))
        } catch (e) {
          // Was `cfg = {}`, which then overwrote the file — DESTROYING every other
          // tool's MCP registration — and still reported {ok: true}. A registry we
          // cannot parse is a registry we must not rewrite.
          return {
            error:
              `${claudeMcp} is not valid JSON (${(e as Error).message}). ` +
              `Refusing to overwrite it — fix or move the file, then install again.`,
          }
        }
        if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
          return {
            error: `${claudeMcp} is not a JSON object. Refusing to overwrite it.`,
          }
        }
      }
      cfg.mcpServers ??= {}
      cfg.mcpServers['terminal-harness'] = {
        command: binPath,
        args: [],
      }
      mkdirSync(dirname(claudeMcp), { recursive: true })
      writeFileSync(claudeMcp, JSON.stringify(cfg, null, 2))
      installed.push('Claude Code (~/.claude/mcp.json)')
    } catch (e) {
      return { error: `failed to write Claude config: ${(e as Error).message}` }
    }
    return { ok: true, installed }
  })
  // Hand a target to a configured external app via `open -a <App>` (robust, no
  // PATH/CLI dependency), falling back to the OS default if the app isn't there.
  function openInApp(appName: string, target: string, fallback: () => void) {
    try {
      const p = cpSpawn('open', ['-a', appName, target], { stdio: 'ignore' })
      p.on('error', fallback)
      p.on('exit', (code) => {
        if (code !== 0) fallback()
      })
    } catch {
      fallback()
    }
  }
  // "Open in browser" — the configured browser (default Brave) with its extensions/wallet.
  // `open -a <App> <target>` hands the OS an arbitrary string, so this sink needs
  // the same scheme gate as shell.openExternal (url-safety.ts) — otherwise it is
  // simply a second, unguarded way to reach an OS protocol handler.
  handle('open:in-browser', (_e, url: string) => {
    if (!isExternallyOpenableUrl(url)) return openExternalSafe(url)
    openInApp(resolvedBrowserApp(), url, () => openExternalSafe(url))
  })
  // "Open in editor" — the configured editor (default Cursor). Opens a path; defaults
  // to the active session's repo root. Renderer-supplied paths are constrained to
  // the roots the UI legitimately surfaces (workspace, worktrees, the active repo,
  // TerMinal's config dir) so this can't be turned into an arbitrary "open any
  // file on disk in an app" primitive.
  function editorOpenRoots(): (string | undefined)[] {
    return [
      resolvedProjectsDir(),
      resolvedWorktreesDir(),
      repoRootOf(deps.cur().cwd) || deps.cur().cwd,
      deps.activeDaemon().filesRoot(),
      terminalConfigDir(),
    ]
  }
  handle('open:in-editor', (_e, path?: string) => {
    const fallbackTarget = repoRootOf(deps.cur().cwd) || deps.cur().cwd || homedir()
    const target = path ? resolveWithinAny(editorOpenRoots(), path) : fallbackTarget
    if (!target) {
      console.error(
        '[gt] refused open:in-editor outside allowed roots:',
        String(path).slice(0, 120),
      )
      return
    }
    openInApp(resolvedEditorApp(), target, () => shell.openPath(target))
  })
  handle('clipboard:write', (_e, text: string) => clipboard.writeText(text))
  handle('clipboard:read', () => clipboard.readText())
  handle('clipboard:imageToFile', () => {
    const img = clipboard.readImage()
    if (img.isEmpty()) return null
    const dir = join(tmpdir(), 'terminal-pastes')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `paste-${randomUUID().slice(0, 8)}.png`)
    writeFileSync(file, img.toPNG())
    return file
  })
}
