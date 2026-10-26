#!/usr/bin/env bash
# Install the default System One decision model (Laya) into an isolated venv.
# The model is optional: Piano falls back to running a skippable stage when the
# local server is unavailable.
set -euo pipefail

VENV="${PIANO_LAYA_VENV:-$HOME/.piano/laya-venv}"
PYTHON="${PIANO_PYTHON:-python3}"

if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "python3 not found; install Python 3.10+ to enable the Laya decision model" >&2
  exit 1
fi

if ! "$PYTHON" - <<'PY'
import sys
raise SystemExit(0 if sys.version_info >= (3, 10) else 1)
PY
then
  echo "Laya requires Python 3.10 or newer" >&2
  exit 1
fi

if [[ ! -x "$VENV/bin/python" ]]; then
  mkdir -p "$(dirname "$VENV")"
  "$PYTHON" -m venv "$VENV"
fi

"$VENV/bin/python" -m pip install --upgrade pip --disable-pip-version-check

if command -v uv >/dev/null 2>&1; then
  uv pip install --python "$VENV/bin/python" --torch-backend=cpu "laya[serve]"
else
  # Install the CPU-only torch wheel first. A plain PyPI install can pull
  # CUDA runtime libraries onto machines that have no GPU.
  "$VENV/bin/python" -m pip install --disable-pip-version-check \
    --index-url https://download.pytorch.org/whl/cpu torch
  "$VENV/bin/python" -m pip install --disable-pip-version-check "laya[serve]"
fi

# Download the English checkpoint during installation so the first skippable
# stage does not pay the Hugging Face download cost. `preload` also verifies
# that the model files can be loaded on this machine.
"$VENV/bin/python" - <<'PY'
from laya import Router

Router(device="cpu", preload=["english"])
print("Laya English checkpoint downloaded and loadable")
PY

echo "Laya installed in $VENV"
echo "Start the local inference service with:"
echo "  LAYA_DEVICE=cpu LAYA_MODELS=english LAYA_HOST=127.0.0.1 $VENV/bin/laya-serve"
echo "The installed service is normally started automatically by Piano."
