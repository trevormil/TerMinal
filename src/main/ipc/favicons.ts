// Bookmark favicon cache IPC. The renderer sees the page's favicon URL (the
// <webview> `page-favicon-updated` event) but must not fetch or render it
// itself — see src/main/favicons.ts for why.

import { handle } from '../typed-ipc'
import { cacheFavicon, readFaviconDataUrl } from '../favicons'

export function registerFaviconsIpc(): void {
  handle('favicons:cache', (_e, pageUrl: string, iconUrl: string) => cacheFavicon(pageUrl, iconUrl))
  handle('favicons:read', (_e, name: string) => readFaviconDataUrl(name))
}
