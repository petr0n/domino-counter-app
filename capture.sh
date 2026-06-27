#!/usr/bin/env bash
# Dev-only: launch the capture server + a public tunnel so the phone can scan
# with the live code and save the EXACT frame each scan processed into
# eval/sessions/<id>/photos/ (post-guide-crop, pre-preprocess — the precise
# input scanCanvas saw). Feed those frames to `node eval/browser_eval.cjs --frames`
# for a phone-EXACT eval. NOT shipped.
#   ./capture.sh
set -euo pipefail
cd "$(dirname "$0")"

cleanup() { kill "${SRV_PID:-}" "${TUN_PID:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "Starting capture server on :8766 …"
node log-server.cjs & SRV_PID=$!
sleep 1

echo "Opening cloudflared tunnel …"
cloudflared tunnel --url http://localhost:8766 2>&1 | tee /tmp/domino-tunnel.log & TUN_PID=$!

# Wait for the tunnel URL to appear, then print phone instructions.
for _ in $(seq 1 30); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/domino-tunnel.log | head -1 || true)
  [ -n "${URL:-}" ] && break
  sleep 1
done

echo
if [ -n "${URL:-}" ]; then
  echo "════════════════════════════════════════════════════════════"
  echo " On your phone, open:"
  echo "   ${URL}/quick.html"
  echo " Scan tiles as usual. Each scan saves the exact frame to"
  echo "   eval/sessions/  (the phone's count is in the filename _dN)."
  echo " When done, Ctrl-C here, then run:"
  echo "   node eval/browser_eval.cjs --frames"
  echo "════════════════════════════════════════════════════════════"
else
  echo "Tunnel URL not detected yet — check /tmp/domino-tunnel.log"
fi
echo
wait "$SRV_PID"
