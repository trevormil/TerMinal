#!/bin/bash
# http-check — generic uptime + TLS-expiry probe feeding the TerMinal check
# contract. Zero LLM cost: pure curl/openssl, one `terminal-cli check-status`
# call at the end (HITL fires only on a state transition).
#
# Config (schedule env or shell env):
#   CHECK_URLS       space-separated https URLs to probe (required)
#   CHECK_KIND       check kind label            (default: http)
#   CHECK_SCOPE      'global' for a fleet-wide check; default scopes to the
#                    repo the schedule runs in (TERMINAL_REPO)
#   CERT_WARN_DAYS   warn when a cert is closer  (default: 15)
set -uo pipefail

URLS="${CHECK_URLS:-}"
KIND="${CHECK_KIND:-http}"
WARN_DAYS="${CERT_WARN_DAYS:-15}"
if [ -z "$URLS" ]; then
  echo "http-check: set CHECK_URLS (space-separated URLs)" >&2
  exit 2
fi

status=ok
up=0 down=0 warnhits=0
soonest_days=""
items="[]"

for url in $URLS; do
  host=$(echo "$url" | sed -E 's#^https?://##; s#[/:].*$##')
  code=$(curl -so /dev/null -w '%{http_code}' --max-time 10 "$url" || echo 000)
  ms=$(curl -so /dev/null -w '%{time_total}' --max-time 10 "$url" 2>/dev/null || echo 0)
  ms=$(printf '%.0f' "$(echo "$ms * 1000" | bc 2>/dev/null || echo 0)")

  # Cert days remaining (best-effort; only meaningful for https).
  days=""
  notafter=$(echo | openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null |
    openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  if [ -n "$notafter" ]; then
    end=$(date -j -f '%b %e %T %Y %Z' "$notafter" +%s 2>/dev/null || date -d "$notafter" +%s 2>/dev/null)
    [ -n "${end:-}" ] && days=$(((end - $(date +%s)) / 86400))
  fi

  health=ok
  if [ "$code" = "000" ] || [ "$code" -ge 500 ]; then
    health=fail; down=$((down + 1)); status=fail
  elif [ "$code" -ge 400 ]; then
    health=warn; warnhits=$((warnhits + 1)); [ "$status" = ok ] && status=warn
  else
    up=$((up + 1))
  fi
  if [ -n "$days" ]; then
    [ -z "$soonest_days" ] || [ "$days" -lt "$soonest_days" ] && soonest_days=$days
    if [ "$days" -lt "$WARN_DAYS" ]; then
      [ "$health" = ok ] && health=warn
      [ "$status" = ok ] && status=warn
    fi
  fi
  items=$(ITEMS="$items" HOST="$host" HEALTH="$health" CODE="$code" MS="$ms" DAYS="$days" bun -e '
    const arr = JSON.parse(process.env.ITEMS)
    arr.push({ label: process.env.HOST, health: process.env.HEALTH,
      meta: { http: process.env.CODE, latencyMs: Number(process.env.MS),
        ...(process.env.DAYS ? { certDays: Number(process.env.DAYS) } : {}) } })
    console.log(JSON.stringify(arr))')
done

total=$((up + down + warnhits))
summary="$up/$total up"
[ "$down" -gt 0 ] && summary="$summary · $down down"
[ -n "$soonest_days" ] && summary="$summary · soonest cert ${soonest_days}d"

detail=$(ITEMS="$items" bun -e 'console.log(JSON.stringify({ sections: [{ title: "Uptime", items: JSON.parse(process.env.ITEMS) }] }))')
metrics="{\"up\":$up,\"down\":$down,\"warn\":$warnhits${soonest_days:+,\"soonestCertDays\":$soonest_days}}"

tmp=$(mktemp)
printf '%s' "$detail" >"$tmp"
scope_args=()
[ -n "${CHECK_SCOPE:-}" ] && scope_args+=("--scope=$CHECK_SCOPE")
terminal-cli check-status "$KIND" "$status" \
  --summary="$summary" --metrics-json="$metrics" --detail-json="@$tmp" "${scope_args[@]}"
rm -f "$tmp"
