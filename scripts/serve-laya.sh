#!/usr/bin/env bash
# Start the local Laya System One service on the endpoint Piano expects.
set -euo pipefail

VENV="${PIANO_LAYA_VENV:-$HOME/.piano/laya-venv}"
SERVER="$VENV/bin/laya-serve"

if [[ ! -x "$SERVER" ]]; then
  echo "Laya is not installed at $VENV; run scripts/setup-laya.sh first" >&2
  exit 1
fi

export LAYA_DEVICE="${LAYA_DEVICE:-cpu}"
export LAYA_MODELS="${LAYA_MODELS:-english}"
export LAYA_PRELOAD="${LAYA_PRELOAD:-1}"
export LAYA_HOST="${LAYA_HOST:-127.0.0.1}"
export LAYA_PORT="${LAYA_PORT:-8000}"
exec "$SERVER"
