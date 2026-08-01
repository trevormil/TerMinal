import { createRoot } from 'react-dom/client'
import App from './App'
import { migrateColumnLayout } from './lib/columnLayout'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import '@xterm/xterm/css/xterm.css'
import 'highlight.js/styles/github-dark.css'
import './index.css'

// The "ResizeObserver loop" warning is benign but, uncaught, trips the Vite dev
// error overlay (which flickers over the UI and blocks clicks). Swallow it.
window.addEventListener('error', (e) => {
  if (typeof e.message === 'string' && e.message.includes('ResizeObserver loop')) {
    e.stopImmediatePropagation()
    e.preventDefault()
  }
})

// A file dropped anywhere the app doesn't explicitly handle it makes Chromium
// NAVIGATE to that file — rendering a local .html inside the window that owns
// `window.gt`. Suppress the default at the document level so the drop is simply
// ignored. These fire during bubbling, after the app's own drop targets
// (Terminal, Files, PluginDrawer, session tabs) have already run, so real
// drag-and-drop is unaffected; preventDefault only cancels the browser's
// navigate-to-dropped-file behaviour. The main process refuses the navigation
// too (window-guard.ts) — this is the renderer half of the same guard.
document.addEventListener('dragover', (e) => e.preventDefault())
document.addEventListener('drop', (e) => e.preventDefault())

// The cockpit and the Files column became one column; fold their two stored
// layouts into one BEFORE the first render, because `useResizableWidth` reads
// localStorage in its state initialiser. No-op after the first launch.
migrateColumnLayout()

// No StrictMode: its double-invoked effects would spawn the PTY twice in dev.
createRoot(document.getElementById('root')!).render(<App />)
