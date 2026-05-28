import { createRoot } from 'react-dom/client'
import App from './App'
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

// No StrictMode: its double-invoked effects would spawn the PTY twice in dev.
createRoot(document.getElementById('root')!).render(<App />)
