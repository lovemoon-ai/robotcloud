#!/usr/bin/env bash
# Lightweight wrapper for lerobot-train.
# - Converts legacy flags to new style
# - Drops scheduler-specific hints
# - Forwards everything as --key=value args to lerobot-train

set -euo pipefail

VENV=$HOME/code/github/lerobot/.venv
source $VENV/bin/activate

if ! command -v lerobot-train >/dev/null 2>&1; then
  echo "Error: lerobot-train not found in PATH" >&2
  exit 127
fi

OUT_ARGS=()
HAS_POLICY_DEVICE=false
# Capture optional output_dir to map to Hydra's run dir
HYDRA_RUN_DIR=""
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

  # Track if policy.device is explicitly set
  if [[ "$arg" == "--policy.device="* || "$arg" == "policy.device="* ]]; then
    HAS_POLICY_DEVICE=true
  fi

  # Map output_dir/output-dir to hydra.run.dir
  if [[ "$arg" == "--output_dir="* || "$arg" == "output_dir="* ]]; then
    HYDRA_RUN_DIR="${arg#*=}"
    continue
  fi
  if [[ "$arg" == "--output-dir="* || "$arg" == "output-dir="* ]]; then
    HYDRA_RUN_DIR="${arg#*=}"
    continue
  fi

  OUT_ARGS+=("$arg")
done

# optional
if [[ "$HAS_POLICY_DEVICE" == false ]]; then
  OUT_ARGS+=("--policy.device=cuda")
fi

# default
OUT_ARGS+=("--policy.push_to_hub=false")
OUT_ARGS+=("--save_checkpoint=true")
OUT_ARGS+=("--wandb.enable=false")

# If scheduler provided an output directory, forward as Hydra run dir
if [[ -n "$HYDRA_RUN_DIR" ]]; then
  OUT_ARGS+=("hydra.run.dir=$HYDRA_RUN_DIR")
fi

exec lerobot-train "${OUT_ARGS[@]}"
