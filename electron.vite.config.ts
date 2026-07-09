import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'

// Build stamp — baked in at build time so the running app can report exactly
// which commit it was built from. Critical now that we release from main after a
// PR merges (not on every commit): the installed app can drift from main, and
// this is how you check what's actually installed. See runbooks/build-and-release.
const git = (cmd: string): string => {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}
const BUILD_SHA = git('git rev-parse --short HEAD') || 'unknown'
const BUILD_BRANCH = git('git rev-parse --abbrev-ref HEAD') || 'unknown'
const BUILD_DIRTY = git('git status --porcelain') ? '-dirty' : ''
const BUILD_TIME = new Date().toISOString()
const define = {
  __BUILD_SHA__: JSON.stringify(BUILD_SHA + BUILD_DIRTY),
  __BUILD_BRANCH__: JSON.stringify(BUILD_BRANCH),
  __BUILD_TIME__: JSON.stringify(BUILD_TIME),
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
    plugins: [react(), tailwindcss()],
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
