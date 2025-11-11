#!/usr/bin/env bash
# Minimal pass-through wrapper for lerobot-train.
# Forwards all arguments directly to lerobot-train without interpretation.

set -euo pipefail

if ! command -v lerobot-train >/dev/null 2>&1; then
  echo "Error: lerobot-train not found in PATH" >&2
  exit 127
fi

exec lerobot-train "$@"
