#!/usr/bin/env bash
# Lightweight wrapper for lerobot-train.
# - Converts legacy flags to new style
# - Drops scheduler-specific hints
# - Forwards everything as --key=value args to lerobot-train

set -euo pipefail

if ! command -v lerobot-train >/dev/null 2>&1; then
  echo "Error: lerobot-train not found in PATH" >&2
  exit 127
fi

OUT_ARGS=()
for arg in "$@"; do
  # Normalize learning rate: learning_rate -> optimizer.lr
  if [[ "$arg" == "--learning_rate="* ]]; then
    OUT_ARGS+=("--optimizer.lr=${arg#--learning_rate=}")
    continue
  fi
  if [[ "$arg" == "learning_rate="* ]]; then
    OUT_ARGS+=("--optimizer.lr=${arg#learning_rate=}")
    continue
  fi

  # Drop dataset mode hints from scheduler
  if [[ "$arg" == "--dataset.mode=local" || "$arg" == "dataset.mode=local" || "$arg" == "--dataset-mode=local" || "$arg" == "dataset-mode=local" ]]; then
    continue
  fi

  OUT_ARGS+=("$arg")
done

exec lerobot-train "${OUT_ARGS[@]}"
