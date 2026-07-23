#!/bin/bash
# fleet-health — polls a control-plane style status backend (any service
# exposing /api/v1/status, /api/v1/snapshot, /api/v1/ci, /api/v1/alerts with a
# bearer token) and feeds the TerMinal check contract. Zero LLM cost. HITL
# fires only on state transitions; run with --digest (e.g. one daily schedule)
# to additionally file a severity=normal daily summary.
#
# Config (schedule env or shell env):
#   CONTROL_PLANE_URL         e.g. https://control.example.com     (required)
#   CONTROL_PLANE_TOKEN       bearer token, OR
#   CONTROL_PLANE_TOKEN_FILE  path to a 0600 file holding the token — prefer
#                             this for schedules (their env is plaintext JSON)
set -uo pipefail

BASE="${CONTROL_PLANE_URL:-}"
TOKEN="${CONTROL_PLANE_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -n "${CONTROL_PLANE_TOKEN_FILE:-}" ]; then
  TOKEN="$(tr -d '[:space:]' <"$CONTROL_PLANE_TOKEN_FILE" 2>/dev/null || true)"
fi
if [ -z "$BASE" ] || [ -z "$TOKEN" ]; then
  echo "fleet-health: set CONTROL_PLANE_URL and CONTROL_PLANE_TOKEN(_FILE)" >&2
  exit 2
fi
DIGEST=false
[ "${1:-}" = "--digest" ] && DIGEST=true

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
ok=true
for ep in snapshot ci alerts uptime; do
  curl -fsS --max-time 15 -H "Authorization: Bearer $TOKEN" \
    "$BASE/api/v1/$ep" -o "$work/$ep.json" || ok=false
done

if [ "$ok" = false ] && [ ! -s "$work/snapshot.json" ]; then
  terminal-cli check-status fleet-health fail --global \
    --summary="control plane unreachable at $BASE"
  exit 0
fi

# All shaping in one bun pass: map backend health (ok|warn|critical) to the
# check contract (ok|warn|fail) and build phone-renderable detail sections
# mirroring the old dashboard tabs.
cat >"$work/shape.ts" <<'TS'
const work = process.env.WORK!
const read = (n: string) => {
  try {
    return JSON.parse(require('node:fs').readFileSync(`${work}/${n}.json`, 'utf8'))
  } catch {
    return null
  }
}
const snap = read('snapshot')
const ci = read('ci')
const alerts = read('alerts')
const uptime = read('uptime')

const toCheck = (h: string) => (h === 'critical' ? 'fail' : h === 'warn' ? 'warn' : 'ok')
const status = toCheck(snap?.health || 'critical')

type Item = { label: string; health: string; meta?: Record<string, unknown> }
const cap = (a: Item[]) => a.slice(0, 30)
const sections: { title: string; items: Item[] }[] = []

const wss: any[] = snap?.workspaces || []
sections.push({
  title: 'Workspaces',
  items: wss.map((w) => ({
    label: w.name,
    health: w.unreachable ? 'fail' : toCheck(w.health),
    meta: {
      deployments: w.counts?.deployments,
      unhealthy: w.counts?.deploymentsUnhealthy,
      podIssues: w.counts?.podIssues,
      hostsDown: w.counts?.hostsDown,
      ...(w.soonestCertExpiryDays != null ? { soonestCertDays: w.soonestCertExpiryDays } : {}),
      ...(w.error ? { error: w.error } : {}),
    },
  })),
})

const det = snap?.detail || {}
const deploys: Item[] = []
const pods: Item[] = []
const crons: Item[] = []
const certs: Item[] = []
for (const [wid, d] of Object.entries<any>(det)) {
  for (const dep of d.deployments || [])
    if (dep.health !== 'ok')
      deploys.push({
        label: `${wid} · ${dep.namespace}/${dep.name}`,
        health: toCheck(dep.health),
        meta: { state: dep.state, ready: `${dep.ready}/${dep.desired}` },
      })
  for (const p of d.podIssues || [])
    pods.push({
      label: `${wid} · ${p.namespace}/${p.name}`,
      health: toCheck(p.health),
      meta: { phase: p.phase, reason: p.reason, restarts: p.restarts },
    })
  for (const c of d.cronJobs || [])
    if (c.health !== 'ok')
      crons.push({
        label: `${wid} · ${c.namespace}/${c.name}`,
        health: toCheck(c.health),
        meta: { schedule: c.schedule, lastRun: c.lastRun, suspended: c.suspended },
      })
  for (const c of d.certificates || [])
    if (c.state !== 'ok')
      certs.push({
        label: c.hostname,
        health: toCheck(c.health),
        meta: { state: c.state, daysRemaining: c.daysRemaining, issuer: c.issuer },
      })
}
if (deploys.length) sections.push({ title: 'Deployments', items: cap(deploys) })
if (pods.length) sections.push({ title: 'Pod issues', items: cap(pods) })
if (crons.length) sections.push({ title: 'Scheduled jobs', items: cap(crons) })
if (certs.length) sections.push({ title: 'Certificates', items: cap(certs) })

const hosts: Item[] = (uptime?.history || [])
  .filter((h: any) => !h.parked)
  .map((h: any) => ({
    label: h.hostname,
    health: h.availability == null ? 'warn' : h.availability < 0.99 ? 'warn' : 'ok',
    meta: {
      availability: h.availability != null ? `${(h.availability * 100).toFixed(2)}%` : 'n/a',
      avgMs: h.averageLatencyMs != null ? Math.round(h.averageLatencyMs) : undefined,
    },
  }))
if (hosts.length) sections.push({ title: 'Uptime (24h)', items: cap(hosts) })

const flows: any[] = ci?.workflows || []
const ciBad = flows.filter((w) => w.health !== 'ok')
if (ci?.configured)
  sections.push({
    title: 'CI',
    items: cap(
      (ciBad.length ? ciBad : flows).map((w) => ({
        label: `${w.repo} · ${w.workflow}`,
        health: toCheck(w.health),
        meta: {
          conclusion: w.conclusion,
          ...(w.consecutiveFailures > 1 ? { streak: `×${w.consecutiveFailures}` } : {}),
          ...(w.url ? { url: w.url } : {}),
        },
      })),
    ),
  })

const act: any[] = alerts?.alerts || []
if (act.length)
  sections.push({
    title: 'Alerts',
    items: cap(
      act.map((a) => ({
        label: a.title,
        health: toCheck(a.health),
        meta: { kind: a.kind, urgency: a.urgency, detail: a.detail, since: a.since },
      })),
    ),
  })

const counts = wss.reduce(
  (acc, w) => {
    acc.podIssues += w.counts?.podIssues || 0
    acc.unhealthy += w.counts?.deploymentsUnhealthy || 0
    acc.hostsDown += w.counts?.hostsDown || 0
    acc.certsExpiring += w.counts?.certsExpiringSoon || 0
    return acc
  },
  { podIssues: 0, unhealthy: 0, hostsDown: 0, certsExpiring: 0 },
)
const bits = [`${wss.filter((w: any) => w.health === 'ok').length}/${wss.length} workspaces green`]
if (counts.unhealthy) bits.push(`${counts.unhealthy} deploy down`)
if (counts.podIssues) bits.push(`${counts.podIssues} pod issues`)
if (counts.hostsDown) bits.push(`${counts.hostsDown} hosts down`)
if (counts.certsExpiring) bits.push(`${counts.certsExpiring} certs expiring`)
if (ci?.configured) bits.push(`CI ${flows.length - ciBad.length}/${flows.length} green`)
if (alerts?.counts?.immediate) bits.push(`${alerts.counts.immediate} urgent alerts`)

const fs = require('node:fs')
fs.writeFileSync(`${work}/detail.json`, JSON.stringify({ sections }))
fs.writeFileSync(
  `${work}/out.json`,
  JSON.stringify({
    status,
    summary: bits.join(' · '),
    metrics: { ...counts, workspaces: wss.length, alertsImmediate: alerts?.counts?.immediate || 0 },
  }),
)
TS
WORK="$work" bun "$work/shape.ts"

status=$(bun -e "console.log(JSON.parse(require('node:fs').readFileSync('$work/out.json','utf8')).status)")
summary=$(bun -e "console.log(JSON.parse(require('node:fs').readFileSync('$work/out.json','utf8')).summary)")
metrics=$(bun -e "console.log(JSON.stringify(JSON.parse(require('node:fs').readFileSync('$work/out.json','utf8')).metrics))")

terminal-cli check-status fleet-health "$status" --global \
  --summary="$summary" --metrics-json="$metrics" --detail-json="@$work/detail.json"

if [ "$DIGEST" = true ]; then
  terminal-cli hitl "Daily fleet digest" "$summary" --severity=normal
fi
