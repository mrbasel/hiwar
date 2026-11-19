#!/usr/bin/env bash
#
# tunnel.sh — create or update the site's Cloudflare Tunnel, from this machine
#
# Makes sure the account has a tunnel named $TUNNEL, routes $HOSTNAME through
# it to the app, and points $HOSTNAME's DNS record at it; changes nothing
# that's already right. Prints the tunnel's token, which cloudflared on the
# server runs with: keep it in host_vars/rawi/vault.yml as vault_tunnel_token.
#
# Needs CF_ACCOUNT_ID and CF_TUNNEL_API_TOKEN (Account: Cloudflare Tunnel
# edit, Zone: DNS edit on the domain), read from the repo's .env.
#
# Usage:
#   ./ansible/scripts/tunnel.sh
#
set -euo pipefail

TUNNEL=rawi
HOSTNAME=podcasts.baselalnassr.com
ZONE=baselalnassr.com
SERVICE=http://localhost:3000

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
set -a
# shellcheck disable=SC1091
[[ -f .env ]] && source .env
set +a
: "${CF_ACCOUNT_ID:?not set}" "${CF_TUNNEL_API_TOKEN:?not set}"

API=https://api.cloudflare.com/client/v4

cf() {
  local method=$1 path=$2
  shift 2
  local body
  body=$(curl -sS -X "$method" "$API$path" -H "Authorization: Bearer $CF_TUNNEL_API_TOKEN" \
    -H "Content-Type: application/json" "$@")
  if [[ $(jq -r .success <<<"$body") != true ]]; then
    echo "$method $path failed: $(jq -c .errors <<<"$body")" >&2
    exit 1
  fi
  jq .result <<<"$body"
}

tunnels=$(cf GET "/accounts/$CF_ACCOUNT_ID/cfd_tunnel?name=$TUNNEL&is_deleted=false")
id=$(jq -r '.[0].id // empty' <<<"$tunnels")
if [[ -z $id ]]; then
  id=$(cf POST "/accounts/$CF_ACCOUNT_ID/cfd_tunnel" \
    --data "$(jq -n --arg name "$TUNNEL" '{name: $name, config_src: "cloudflare"}')" | jq -r .id)
  echo "created tunnel $TUNNEL ($id)" >&2
else
  echo "tunnel $TUNNEL exists ($id)" >&2
fi

config=$(jq -n --arg host "$HOSTNAME" --arg service "$SERVICE" \
  '{config: {ingress: [{hostname: $host, service: $service}, {service: "http_status:404"}]}}')
cf PUT "/accounts/$CF_ACCOUNT_ID/cfd_tunnel/$id/configurations" --data "$config" >/dev/null
echo "routes $HOSTNAME to $SERVICE" >&2

zone=$(cf GET "/zones?name=$ZONE" | jq -r '.[0].id')
record=$(jq -n --arg name "$HOSTNAME" --arg target "$id.cfargotunnel.com" \
  '{type: "CNAME", name: $name, content: $target, proxied: true, comment: "rawi tunnel (ansible/scripts/tunnel.sh)"}')
existing=$(cf GET "/zones/$zone/dns_records?name=$HOSTNAME" | jq -r '.[0].id // empty')
if [[ -z $existing ]]; then
  cf POST "/zones/$zone/dns_records" --data "$record" >/dev/null
  echo "created the DNS record for $HOSTNAME" >&2
else
  cf PUT "/zones/$zone/dns_records/$existing" --data "$record" >/dev/null
  echo "updated the DNS record for $HOSTNAME" >&2
fi

cf GET "/accounts/$CF_ACCOUNT_ID/cfd_tunnel/$id/token" | jq -r .
