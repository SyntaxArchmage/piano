#!/usr/bin/env bash
# Shared output helpers for repository setup scripts.

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}PASS${NC}  $*"; }
skip() { echo -e "  ${YELLOW}SKIP${NC}  $*"; }
warn() { echo -e "  ${YELLOW}WARN${NC}  $*"; }
fail() { echo -e "  ${RED}FAIL${NC}  $*"; exit 1; }
step() { echo "  ...  $*"; }
ok() { echo -e "${GREEN}${BOLD}✓${NC}  $*"; }
err() { echo -e "${RED}${BOLD}✗${NC}  $*"; }

require_node() {
  command -v node &>/dev/null || fail "node not found — install Node.js (https://nodejs.org)"
}
