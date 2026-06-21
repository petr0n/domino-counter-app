#!/usr/bin/env bash
# Live detection-capture session: unified dev server + cloudflared HTTPS tunnel.
# Usage: bash eval/capture.sh   (Ctrl-C to stop)
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Free the port if a previous server/static server is holding it.
lsof -nP -tiTCP:8766 -sTCP:LISTEN 2>/dev/null | xargs -r kill 2>/dev/null || true

node "$DIR/log-server.cjs" &
SRV=$!
trap "kill $SRV 2>/dev/null" EXIT
sleep 1
echo "Local:  http://localhost:8766/quick.html"
echo "Opening HTTPS tunnel (open the trycloudflare URL on your phone)…"
cloudflared tunnel --url http://localhost:8766