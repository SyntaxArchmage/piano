#!/usr/bin/env bash
# Dev-mode entry: verify Node >= 22, install deps, link the CLI, and report
# that source edits take effect immediately (tsx source-direct, no build step).
# Run from anywhere: bash scripts/dev.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
. "$SCRIPT_DIR/lib.sh"

step "checking node version"
require_node
pass "node $(node --version)"

step "installing dependencies (npm install)"
(cd "$REPO_ROOT" && npm install)

step "linking CLI (npm link --workspace @piano/cli)"
(cd "$REPO_ROOT" && npm link --workspace @piano/cli)

ok "dev mode: edits to packages/**/src take effect immediately (tsx source-direct)"
