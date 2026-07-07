import { useEffect, useState } from 'react'
import { Shield, RefreshCw, ExternalLink } from 'lucide-react'
import type { Tab, TabContext } from '../../lib/types'

// The Admin tab embeds the standalone fleet meta-dashboard (fleet-admin →
// admin.trevormil.com). It is OFF BY DEFAULT for anyone who clones TerMinal —
// it only appears once `fleetAdminUrl` is set in TerMinal settings (personal /
// local-first). At module load we mirror that setting into localStorage so the
// synchronous `appliesTo` gate can read it.
const LS_KEY = 'gt.fleetAdminUrl'
void window.gt?.settings
  ?.get?.()
  .then((s: unknown) => {
    const url = (s as { fleetAdminUrl?: string })?.fleetAdminUrl?.trim() || ''
    if (url) localStorage.setItem(LS_KEY, url)
    else localStorage.removeItem(LS_KEY)
  })
  .catch(() => {})

function fleetUrl(): string {
  return localStorage.getItem(LS_KEY) || ''
}

function AdminTab({ ctx: _ctx }: { ctx: TabContext }) {
  const [nonce, setNonce] = useState(0)
  const [url, setUrl] = useState(fleetUrl())
  useEffect(() => {
    // in case the setting resolved after first paint
    const u = fleetUrl()
    if (u && u !== url) setUrl(u)
  }, [url])

  if (!url) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--gt-bg)] p-8 text-center text-[12px] text-zinc-500">
        Set <code className="mx-1 rounded bg-black/30 px-1">fleetAdminUrl</code> in TerMinal settings to embed the fleet dashboard.
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col bg-[var(--gt-bg)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-3 py-1.5 text-[11px] text-zinc-500">
        <Shield size={12} className="text-[var(--gt-accent-light)]" />
        <span className="font-mono">{url}</span>
        <button onClick={() => setNonce((n) => n + 1)} className="ml-auto hover:text-zinc-200" title="Reload">
          <RefreshCw size={12} />
        </button>
        <button onClick={() => window.gt.openExternal(url)} className="hover:text-zinc-200" title="Open externally">
          <ExternalLink size={12} />
        </button>
      </div>
      <iframe
        key={nonce}
        src={url}
        title="fleet-admin"
        className="min-h-0 w-full flex-1 border-0"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  )
}

const tab: Tab = {
  id: 'admin',
  title: 'Admin',
  icon: Shield,
  order: 8.7,
  // Off by default — only shown when a fleet dashboard URL is configured.
  appliesTo: () => !!fleetUrl(),
  Component: AdminTab,
}
export default tab
