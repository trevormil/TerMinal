// Navigation + CSP guards for the app's own BrowserWindow.
//
// The renderer holds `window.gt` — the whole privileged IPC surface, including
// command execution. Any way to get remote content *into that window* (a
// top-level navigation, a dropped .html file) hands that surface to whoever
// authored the page. Electron only stops that if you say so, so this module
// holds the two pure decisions the window makes:
//
//   • navigationDecision — what the main frame / subframes may navigate to
//   • appCsp             — the policy stamped onto the app document
//
// Both live here (rather than inline in index.ts) so they are testable without
// booting Electron.

/** Is `target` the app's own document/origin? */
export function isAppUrl(target: string, appUrl: string): boolean {
  try {
    const t = new URL(target)
    const a = new URL(appUrl)
    if (t.protocol !== a.protocol) return false
    // file:// has an opaque ("null") origin, so compare the document path.
    if (a.protocol === 'file:')
      return t.host === a.host && decodeURIComponent(t.pathname) === decodeURIComponent(a.pathname)
    return t.origin === a.origin
  } catch {
    return false
  }
}

// Subframes legitimately host non-app content: a `url` custom tab iframes a
// dashboard/dev server, command tabs render via srcdoc, and the Files tab
// previews a PDF as a `data:` URL. Those frames are sandboxed and have no
// preload, and a `data:` frame gets an OPAQUE origin — it is not the app origin
// and cannot reach `window.gt`. The main frame has no such excuse.
//
// `data:` must be listed: `will-frame-navigate` fires on iframe src loads, so
// omitting it silently blanked every PDF preview (FileViewer.tsx) — and it is
// already in `appCsp`'s frame-src, so the two guards contradicted each other
// with the stricter one winning invisibly.
const FRAME_SCHEMES = new Set(['http:', 'https:', 'about:', 'blob:', 'data:'])

export function navigationDecision(
  target: string,
  appUrl: string,
  isMainFrame: boolean,
): 'allow' | 'block' {
  if (isAppUrl(target, appUrl)) return 'allow'
  if (isMainFrame) return 'block'
  let proto = ''
  try {
    proto = new URL(target).protocol
  } catch {
    return 'block'
  }
  return FRAME_SCHEMES.has(proto) ? 'allow' : 'block'
}

/**
 * CSP for the app document only (webviews run in the `persist:browser`
 * session and are untouched, so ordinary browsing is unaffected).
 *
 * The point of this policy is `script-src 'self'`: no attacker-hosted script
 * can be pulled into the origin that owns `window.gt`. `'unsafe-inline'` and
 * `'unsafe-eval'` stay because the bundler emits inline module preloads and
 * dev HMR needs eval — dropping them is a separate, verify-in-a-packaged-build
 * change, and neither of them permits fetching remote code.
 */
export function appCsp(dev: boolean): string {
  const connect = dev ? "'self' http://localhost:* ws://localhost:*" : "'self'"
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    // https: kept for remote images in rendered markdown (PR/ticket bodies).
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "worker-src 'self' blob:",
    `connect-src ${connect}`,
    // `url` custom tabs iframe http(s) dashboards; command tabs use srcdoc.
    "frame-src 'self' http: https: data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ')
}
