import { useState } from 'react'
import { isHttpUrl } from '../../../../shared/url-safety'
import { LayoutGrid, RefreshCw, ExternalLink } from 'lucide-react'
import type { Tab, TabContext, PinnedPanel } from '../../lib/types'

// Generic "Panels" tab: pin one or more web dashboards (configured in TerMinal settings as
// `pinnedPanels`) and view them embedded here — no browser hop. Nothing app-specific; you
// point it at whatever you want (a fleet dashboard, a status page, Grafana, …). OFF BY
// DEFAULT for cloners — the tab only appears once at least one panel is configured. At module
// load we mirror the setting into localStorage so the synchronous `appliesTo` gate can read it.
const LS_KEY = 'gt.pinnedPanels'
function mirror(list: PinnedPanel[] | undefined) {
  if (list?.length) localStorage.setItem(LS_KEY, JSON.stringify(list))
  else localStorage.removeItem(LS_KEY)
}
void window.gt?.settings
  ?.get?.()
  .then((s: unknown) => mirror((s as { pinnedPanels?: PinnedPanel[] })?.pinnedPanels))
  .catch(() => {})
// Keep the localStorage mirror (and thus the tab's visibility) live when the
// Settings → Panels editor saves. Nudge App to recompute the visible tab list.
window.addEventListener?.('gt.settings.changed', (e) => {
  mirror((e as CustomEvent).detail?.pinnedPanels)
  window.dispatchEvent(new Event('gt.tabs.hidden.changed'))
})

function panels(): PinnedPanel[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as PinnedPanel[]) : []
  } catch {
    return []
  }
}

function PanelsTab({ ctx: _ctx }: { ctx: TabContext }) {
  const [list] = useState<PinnedPanel[]>(panels())
  const [active, setActive] = useState(0)
  const [nonce, setNonce] = useState(0)

  if (!list.length) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--gt-bg)] p-8 text-center text-[12px] text-zinc-500">
        Add a <code className="mx-1 rounded bg-black/30 px-1">pinnedPanels</code> entry in TerMinal
        settings to pin a web dashboard here.
      </div>
    )
  }
  const cur = list[Math.min(active, list.length - 1)]
  return (
    <div className="flex h-full flex-col bg-[var(--gt-bg)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-3 py-1.5 text-[11px] text-zinc-500">
        <LayoutGrid size={12} className="text-[var(--gt-accent-light)]" />
        {list.length > 1 ? (
          <div className="flex items-center gap-1">
            {list.map((p, i) => (
              <button
                key={p.url + i}
                onClick={() => setActive(i)}
                className={`rounded px-1.5 py-0.5 ${i === active ? 'bg-[var(--gt-accent)]/20 text-[var(--gt-accent-light)]' : 'hover:text-zinc-200'}`}
              >
                {p.label || p.url}
              </button>
            ))}
          </div>
        ) : (
          <span className="font-mono">{cur.label || cur.url}</span>
        )}
        <button
          onClick={() => setNonce((n) => n + 1)}
          className="ml-auto hover:text-zinc-200"
          title="Reload"
        >
          <RefreshCw size={12} />
        </button>
        <button
          onClick={() => window.gt.openExternal(cur.url)}
          className="hover:text-zinc-200"
          title="Open externally"
        >
          <ExternalLink size={12} />
        </button>
      </div>
      {isHttpUrl(cur.url) ? (
        <iframe
          key={`${active}:${nonce}`}
          src={cur.url}
          title={cur.label || 'panel'}
          className="min-h-0 w-full flex-1 border-0"
          // NO `allow-same-origin` alongside `allow-scripts`. That pair is the
          // documented sandbox escape: together they let the framed document
          // reach its own DOM and simply REMOVE the sandbox attribute from
          // itself. PR #197 stripped it from UrlTab/CommandTab; this file was
          // owned by a concurrent chain that day and was missed (ticket 102).
          //
          // "The user typed the URL themselves" is not a trust argument once an
          // agent can write settings — and agents write settings here.
          sandbox="allow-scripts allow-forms allow-popups"
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6">
          <div className="max-w-md text-center text-[12px] leading-relaxed text-zinc-500">
            <span className="text-zinc-300">This panel’s URL is not http(s).</span>
            <div className="mt-1.5 break-all font-mono text-[11px] text-zinc-600">
              {String(cur.url)}
            </div>
            <div className="mt-2">
              A frame source is only ever loaded over http or https — anything else (
              <span className="font-mono">file:</span>, <span className="font-mono">data:</span>, an
              OS-registered scheme) would hand the panel powers a web page should not have. Edit the
              panel in Settings.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const tab: Tab = {
  id: 'panels',
  title: 'Panels',
  icon: LayoutGrid,
  order: 8.7,
  // Off by default — only shown when at least one web panel is configured.
  appliesTo: () => panels().length > 0,
  Component: PanelsTab,
}
export default tab
