#!/usr/bin/env bash
# Setup piano as a CLI tool.
# Run from anywhere: bash scripts/setup.sh
# After this, `piano` is available on PATH.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'
pass() { echo -e "  ${GREEN}PASS${NC}  $*"; }
warn() { echo -e "  ${YELLOW}WARN${NC}  $*"; }
fail() { echo -e "  ${RED}FAIL${NC}  $*"; exit 1; }
step() { echo "  ...  $*"; }
ok() { echo -e "${GREEN}${BOLD}✓${NC}  $*"; }
require_node() { command -v node &>/dev/null || fail "node not found — install Node.js (https://nodejs.org)"; }

echo ""
echo "╔══════════════════════════════╗"
echo "║   piano install               ║"
echo "╚══════════════════════════════╝"
echo ""

# ── 1. Prerequisites ────────────────────────────────────────────────────────

step "checking prerequisites"

require_node
pass "node $(node --version)"

if ! command -v npm &>/dev/null; then
  fail "npm not found"
fi
pass "npm $(npm --version)"

# ── 2. Install dependencies ─────────────────────────────────────────────────

step "npm install"
(cd "$REPO_ROOT" && npm install --silent)
pass "dependencies installed"

# ── 2b. Default System One model ───────────────────────────────────────────

step "installing Laya decision model (optional; first run downloads PyTorch)"
if [[ "${PIANO_SKIP_LAYA:-0}" == "1" ]]; then
  warn "skipped via PIANO_SKIP_LAYA=1 — skippable stages will run unconditionally"
elif bash "$SCRIPT_DIR/setup-laya.sh"; then
  pass "Laya installed; start it with scripts/serve-laya.sh"
else
  warn "Laya install failed; skippable stages will run unconditionally"
fi

# ── 3. Link CLI globally ─────────────────────────────────────────────────────

step "linking piano binary (npm link)"
(cd "$REPO_ROOT" && npm link --workspace @piano/cli --silent)
pass "piano linked"

# ── 3b. Agent skill ─────────────────────────────────────────────────────────

step "installing /piano agent skill"
if [[ "${PIANO_SKIP_SKILL_INSTALL:-0}" == "1" ]]; then
  warn "skipped via PIANO_SKIP_SKILL_INSTALL=1"
elif node "$REPO_ROOT/packages/cli/bin/piano.mjs" install-skill; then
  pass "agent skill step complete"
else
  warn "agent skill install failed; run 'piano install-skill' manually"
fi

step "installing Piano MCP server"
if [[ "${PIANO_SKIP_MCP_INSTALL:-0}" == "1" ]]; then
  warn "skipped via PIANO_SKIP_MCP_INSTALL=1"
elif node "$REPO_ROOT/packages/cli/bin/piano.mjs" install-mcp; then
  pass "MCP server step complete"
else
  warn "MCP install failed; run 'piano install-mcp' manually"
fi

# ── 4. Agent config ─────────────────────────────────────────────────────────

step "checking agent config"

CONFIG_FILE="$HOME/.piano/agent.config.json"
CONFIG_TEMPLATE="$SCRIPT_DIR/agent.config.template.json"
if [[ -f "$CONFIG_FILE" ]]; then
  # An existing config carries the user's real credential. Installing over it
  # would destroy it, so the template is only ever placed when nothing is there.
  pass "kept existing config $CONFIG_FILE"
elif [[ ! -f "$CONFIG_TEMPLATE" ]]; then
  warn "config template not found at $CONFIG_TEMPLATE — skipped"
else
  mkdir -p "$(dirname "$CONFIG_FILE")"
  cp "$CONFIG_TEMPLATE" "$CONFIG_FILE"
  pass "created $CONFIG_FILE from template — replace apiKey CHANGE_ME before running"
fi

# ── 5. Verify piano is on PATH ────────────────────────────────────────────────

PIANO_BIN="$(npm prefix -g)/bin/piano"
if command -v piano &>/dev/null; then
  pass "piano found at $(command -v piano)"
elif [[ -x "$PIANO_BIN" ]]; then
  warn "piano installed at $PIANO_BIN but not on PATH"
  echo ""
  echo "  Add this to your shell profile (~/.bashrc, ~/.zshrc, etc.):"
  echo ""
  echo "    export PATH=\"$(npm prefix -g)/bin:\$PATH\""
  echo ""
  echo "  Then reload your shell or run:"
  echo ""
  echo "    source ~/.bashrc   # or ~/.zshrc"
  echo ""
else
  warn "piano binary not found after linking — check npm global prefix is on PATH"
  echo "  npm global prefix: $(npm prefix -g)"
fi

echo ""
echo "════════════════════════════════"
ok "setup complete"
echo ""
echo "  Usage:"
echo "    piano -p \"optimize gemm kernel\""
echo "    piano doctor          # capability report (three-state per harness)"
echo "    scripts/serve-laya.sh # run the local System One service manually"
echo ""
echo "  Dev mode: source edits under packages/**/src take effect immediately (tsx)."
