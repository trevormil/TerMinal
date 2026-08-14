import { shell } from 'electron'
import { isExternallyOpenableUrl } from '../shared/url-safety'

// Only forward web/mail URLs to the OS. Non-http(s) schemes (file://, custom
// protocols) reaching shell.openExternal from rendered content is a known
// Electron footgun — see url-safety.ts.
export const openExternalSafe = (url: unknown): void => {
  if (isExternallyOpenableUrl(url)) void shell.openExternal(url)
  else console.error('[gt] refused openExternal for non-web URL:', String(url).slice(0, 80))
}
