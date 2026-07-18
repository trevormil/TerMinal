import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Build stamp — baked in at build time so the running app can report exactly
// which commit it was built from. Critical now that we release from main after a
// PR merges (not on every commit): the installed app can drift from main, and
// this is how you check what's actually installed. See runbooks/build-and-release.
const git = (cmd: string): string => {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return ''
  }
}
const BUILD_SHA = git('git rev-parse --short HEAD') || 'unknown'
const BUILD_BRANCH = git('git rev-parse --abbrev-ref HEAD') || 'unknown'
const BUILD_DIRTY = git('git status --porcelain') ? '-dirty' : ''
const BUILD_TIME = new Date().toISOString()
// The owner/repo this build was made from (git origin), baked in so provisioned
// hosts self-update from THIS repo — a fork's hosts track the fork, not upstream.
// '' when origin is unknown → self-update is skipped rather than guessed.
const BUILD_REPO_SLUG =
  git('git remote get-url origin').match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/)?.[1] || ''
// Where the source checkout lived at build time. The packaged app uses it to
// find a local clone for the update check (git is exact + fork-aware); when the
// path is gone the check falls back to the GitHub API via BUILD_REPO_SLUG.
const BUILD_REPO_PATH = git('git rev-parse --show-toplevel')
// Template provenance (ticket 0045): the template is embedded in this repo, so
// its version is the last commit that touched templates/project-template.
const TEMPLATE_SHA = git('git log -1 --format=%H -- templates/project-template') || 'unknown'
const APP_VERSION = (
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string
  }
).version
const define = {
  __APP_VERSION__: JSON.stringify(APP_VERSION),
  __BUILD_SHA__: JSON.stringify(BUILD_SHA + BUILD_DIRTY),
  __BUILD_BRANCH__: JSON.stringify(BUILD_BRANCH),
  __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  __BUILD_REPO_SLUG__: JSON.stringify(BUILD_REPO_SLUG),
  __BUILD_REPO_PATH__: JSON.stringify(BUILD_REPO_PATH),
  __TEMPLATE_SHA__: JSON.stringify(TEMPLATE_SHA),
}

// Strict Content-Security-Policy for the packaged renderer — defense-in-depth so
// untrusted content (agent output, PR/MR bodies, notes) can never execute an
// injected script or exfiltrate over the network, even if a future raw-HTML sink
// slipped through. Injected as a <meta> at BUILD time only (`apply: 'build'`), so
// the Vite dev server's HMR (inline scripts + eval + ws) is untouched. The built
// index.html loads only external `'self'` scripts/styles, so `script-src 'self'`
// is safe; `'unsafe-inline'` stays on style-src for React inline styles. frame-src
// stays open for the Browser-tab <webview>; connect-src is 'self' (the renderer
// makes no direct network calls — all I/O goes through the IPC bridge).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-src 'self' https: http:",
].join('; ')
const cspMetaPlugin = {
  name: 'terminal-csp-meta',
  apply: 'build' as const,
  transformIndexHtml(html: string) {
    return html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
    )
  },
}

// node-pty is a native module — keep it external so it isn't bundled.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define,
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: 'src/renderer',
    define,
    plugins: [react(), tailwindcss(), cspMetaPlugin],
    // CodeMirror silently breaks if any core package resolves to more than one
    // copy: the editor and the language parsers end up with different state/view
    // /facet instances, so the language never activates → no syntax highlighting.
    // Dedupe the whole core (versions are pinned to single copies in overrides).
    resolve: {
      dedupe: [
        '@codemirror/state',
        '@codemirror/view',
        '@codemirror/language',
        '@lezer/common',
        '@lezer/highlight',
      ],
    },
  },
})
