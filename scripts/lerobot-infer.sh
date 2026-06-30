#!/usr/bin/env bash
# Lightweight wrapper for lerobot async inference policy server.

set -euo pipefail

VENV=$HOME/code/github/lerobot/.venv
if [[ -f "$VENV/bin/activate" ]]; then
  # shellcheck disable=SC1090
  source "$VENV/bin/activate"
fi

exec python -m lerobot.async_inference.policy_server "$@"
