#!/bin/sh
set -eu
# Works in Grok's /workspace and in a locally exported project.
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# :8081 is QA-only — a revive must never inherit a stale built-output preview.
node scripts/preview.mjs stop || true
APP_PORT=${DRIVETRADE_DEV_PORT:-8080}
if curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:$APP_PORT/"; then
  exit 0
fi
npm run dev -- --port "$APP_PORT" >>/tmp/drivetrade-startup.log 2>&1 &
