#!/usr/bin/env bash
set -u -o pipefail

# Keep Mullvad isolated to cloud/Gemini traffic only by routing
# OpenRouter destinations over mullvad, while leaving host/Tailscale routes unchanged.
TARGET_HOSTS=(
  "openrouter.ai"
)

resolve_ipv4s() {
  local host="$1"
  getent ahostsv4 "$host" 2>/dev/null | awk '{print $1}' | sort -u
}

apply_up() {
  # Remove global default routes injected by wg-quick PostUp.
  ip route del 0.0.0.0/1 dev mullvad metric 10 2>/dev/null || true
  ip route del 128.0.0.0/1 dev mullvad metric 10 2>/dev/null || true

  # Route only OpenRouter endpoint IPs over mullvad.
  local host ip
  for host in "${TARGET_HOSTS[@]}"; do
    while IFS= read -r ip; do
      [ -n "$ip" ] || continue
      ip route replace "${ip}/32" dev mullvad metric 10 2>/dev/null || true
    done < <(resolve_ipv4s "$host")
  done

  # Keep Tailscale control-plane helper route explicit.
  ip route replace 100.100.100.100/32 dev tailscale0 metric 5 2>/dev/null || true

  ip route flush cache
}

apply_down() {
  local host ip
  for host in "${TARGET_HOSTS[@]}"; do
    while IFS= read -r ip; do
      [ -n "$ip" ] || continue
      ip route del "${ip}/32" dev mullvad metric 10 2>/dev/null || true
    done < <(resolve_ipv4s "$host")
  done

  ip route del 100.100.100.100/32 dev tailscale0 metric 5 2>/dev/null || true
  ip route flush cache
}

case "${1:-}" in
  up) apply_up ;;
  down) apply_down ;;
  *)
    echo "Usage: $0 {up|down}" >&2
    exit 1
    ;;
esac
