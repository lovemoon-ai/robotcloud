#!/usr/bin/env bash
# One-click training helper for LeRobot policies.

set -euo pipefail

SCRIPT_NAME=$(basename "$0")

usage() {
  cat <<'EOF'
Usage:
  ./lerobot.sh --policy <act|dp|pi0|pi0.5|smolvla|groot> --dataset <repo_id> [options] [-- extra lerobot-train args]

Required arguments:
  -p, --policy            Policy preset name. Accepts act, dp (diffusion policy), pi0, pi0.5/pi05, smolvla, groot/GR00T.
  -d, --dataset           Dataset repo_id (e.g. hf-user/my_set) passed to --dataset.repo_id.

Common options:
      --device STR        Policy device (cuda, mps, cpu). Auto-detected if omitted.
      --batch-size N      Override batch size (default depends on policy preset).
      --steps N           Override training steps (default depends on policy preset).
      --job-name STR      Explicit job name (defaults to <policy>_<dataset_slug>).
      --output-dir PATH   Training output directory (defaults to outputs/train/<job-name>).
      --wandb [bool]      Enable or disable Weights & Biases logging (default false). Use --wandb true/false.
      --push-to-hub       Enable --policy.push_to_hub (requires --policy-repo).
      --policy-repo ID    Hugging Face repo to push checkpoints to.
      --pretrained ID     Override the base checkpoint used by smolvla/pi0/pi0.5 presets.
      --env-type STR      Optional --env.type value (e.g. metaworld).
      --env-task STR      Optional --env.task value.
      --env-episode-length N  Optional --env.episode_length override.
      --dataset-mode STR  Optional --dataset.mode (hub/local/server).
      --dataset-root PATH Optional --dataset.root for local data.
      --dataset-episodes STR JSON string consumed by --dataset.episodes (e.g. "[0,1,2]").
      --save-freq N       Override --save_freq.
      --log-freq N        Override --log_freq.
      --eval-freq N       Override --eval_freq.
      --eval-batch-size N Override --eval.batch_size.
      --eval-episodes N   Override --eval.n_episodes.
      --num-workers N     Override --num_workers.
      --multi-gpu N       Launch via accelerate with N processes.
      --accelerate-extra STR  Additional accelerate launch arguments (repeatable).
      --dry-run           Print the resolved command without executing it.
  -h, --help              Show this message.

Notes:
  • Defaults are sourced from Makefile test targets and docs in docs/source/*.mdx.
  • Pass `key=value` overrides directly (Hydra style), or use `--` followed by raw arguments to forward anything directly to lerobot-train.
EOF
}

to_lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

detect_device() {
  if command -v nvidia-smi >/dev/null 2>&1; then
    echo "cuda"
  elif [[ "$(uname -s)" == "Darwin" ]]; then
    echo "mps"
  else
    echo "cpu"
  fi
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command '$1' not found in PATH." >&2
    exit 1
  fi
}

POLICY_NAME=""
DATASET_ID=""
ENV_TYPE=""
ENV_TASK=""
ENV_EPISODE_LENGTH=""
DEVICE=""
BATCH_SIZE=""
STEPS=""
JOB_NAME=""
OUTPUT_DIR=""
WANDB_ENABLE="false"
PUSH_TO_HUB="false"
POLICY_REPO=""
PRETRAINED_PATH=""
SAVE_FREQ=""
LOG_FREQ=""
EVAL_FREQ=""
EVAL_BATCH=""
EVAL_EPISODES=""
NUM_WORKERS=""
DATASET_MODE=""
DATASET_ROOT=""
DATASET_EPISODES=""
DRY_RUN="false"
ACCELERATE_PROCS=0
ACCELERATE_EXTRA=()
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--policy)
      POLICY_NAME="$2"
      shift 2
      ;;
    -d|--dataset)
      DATASET_ID="$2"
      shift 2
      ;;
    --device)
      DEVICE="$2"
      shift 2
      ;;
    --batch-size)
      BATCH_SIZE="$2"
      shift 2
      ;;
    --steps)
      STEPS="$2"
      shift 2
      ;;
    --job-name)
      JOB_NAME="$2"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --wandb)
      if [[ $# -gt 1 && "$2" != -* ]]; then
        WANDB_ENABLE=$(to_lower "$2")
        shift 2
      else
        WANDB_ENABLE="true"
        shift 1
      fi
      ;;
    --push-to-hub)
      PUSH_TO_HUB="true"
      shift 1
      ;;
    --policy-repo)
      POLICY_REPO="$2"
      shift 2
      ;;
    --pretrained)
      PRETRAINED_PATH="$2"
      shift 2
      ;;
    --env-type)
      ENV_TYPE="$2"
      shift 2
      ;;
    --env-task)
      ENV_TASK="$2"
      shift 2
      ;;
    --env-episode-length)
      ENV_EPISODE_LENGTH="$2"
      shift 2
      ;;
    --dataset-mode)
      DATASET_MODE="$2"
      shift 2
      ;;
    --dataset-root)
      DATASET_ROOT="$2"
      shift 2
      ;;
    --dataset-episodes)
      DATASET_EPISODES="$2"
      shift 2
      ;;
    --save-freq)
      SAVE_FREQ="$2"
      shift 2
      ;;
    --log-freq)
      LOG_FREQ="$2"
      shift 2
      ;;
    --eval-freq)
      EVAL_FREQ="$2"
      shift 2
      ;;
    --eval-batch-size)
      EVAL_BATCH="$2"
      shift 2
      ;;
    --eval-episodes)
      EVAL_EPISODES="$2"
      shift 2
      ;;
    --num-workers)
      NUM_WORKERS="$2"
      shift 2
      ;;
    --multi-gpu)
      ACCELERATE_PROCS="$2"
      shift 2
      ;;
    --accelerate-extra)
      ACCELERATE_EXTRA+=("$2")
      shift 2
      ;;
    --dry-run)
      DRY_RUN="true"
      shift 1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      EXTRA_ARGS+=("$@")
      break
      ;;
    # Accept Hydra-style overrides (e.g. dataset.mode=local) directly and pass through
    *=*)
      EXTRA_ARGS+=("$1")
      shift 1
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$POLICY_NAME" || -z "$DATASET_ID" ]]; then
  echo "Error: --policy and --dataset are required." >&2
  usage
  exit 1
fi

if [[ "$WANDB_ENABLE" != "true" && "$WANDB_ENABLE" != "false" ]]; then
  echo "Error: --wandb accepts true or false (received '$WANDB_ENABLE')." >&2
  exit 1
fi

if [[ "$PUSH_TO_HUB" == "true" && -z "$POLICY_REPO" ]]; then
  echo "Error: --push-to-hub requires --policy-repo <user/repo>." >&2
  exit 1
fi

# source lerobot venv
VENV=$HOME/code/github/lerobot/.venv
source $VENV/bin/activate

require_cmd lerobot-train

if [[ -z "$DEVICE" ]]; then
  DEVICE=$(detect_device)
fi

policy_key=$(to_lower "${POLICY_NAME// /}")
policy_key=${policy_key//gr00t/groot}
policy_key=${policy_key//pi0.5/pi05}
policy_key=${policy_key//pi0_5/pi05}
policy_key=${policy_key//pi0-5/pi05}

POLICY_ARGS=()

case "$policy_key" in
  act)
    POLICY_ARGS+=(policy.type=act)
    ;;
  dp|diffusion|diffusionpolicy)
    POLICY_ARGS+=(policy.type=diffusion)
    ;;
  pi0)
    POLICY_ARGS+=(policy.type=pi0)
    PRESET_PRETRAINED=${PRETRAINED_PATH:-lerobot/pi0_base}
    POLICY_ARGS+=(policy.pretrained_path="$PRESET_PRETRAINED")
    POLICY_ARGS+=(policy.compile_model=true policy.gradient_checkpointing=true policy.dtype=bfloat16)
    [[ -z "$BATCH_SIZE" ]] && BATCH_SIZE="32"
    [[ -z "$STEPS" ]] && STEPS="3000"
    ;;
  pi05)
    POLICY_ARGS+=(policy.type=pi05)
    PRESET_PRETRAINED=${PRETRAINED_PATH:-lerobot/pi05_base}
    POLICY_ARGS+=(policy.pretrained_path="$PRESET_PRETRAINED")
    POLICY_ARGS+=(policy.compile_model=true policy.gradient_checkpointing=true policy.dtype=bfloat16)
    [[ -z "$BATCH_SIZE" ]] && BATCH_SIZE="32"
    [[ -z "$STEPS" ]] && STEPS="3000"
    ;;
  smolvla)
    PRESET_PRETRAINED=${PRETRAINED_PATH:-lerobot/smolvla_base}
    POLICY_ARGS+=(policy.path="$PRESET_PRETRAINED")
    [[ -z "$BATCH_SIZE" ]] && BATCH_SIZE="64"
    [[ -z "$STEPS" ]] && STEPS="20000"
    ;;
  groot)
    POLICY_ARGS+=(policy.type=groot)
    POLICY_ARGS+=(policy.tune_diffusion_model=false)
    [[ -z "$BATCH_SIZE" ]] && BATCH_SIZE="32"
    [[ -z "$STEPS" ]] && STEPS="10000"
    ;;
  *)
    echo "Unsupported policy preset '$POLICY_NAME'." >&2
    usage
    exit 1
    ;;
esac

if [[ -z "$JOB_NAME" ]]; then
  dataset_slug=$(printf '%s' "$DATASET_ID" | tr '/: ' '__')
  JOB_NAME="${policy_key}_${dataset_slug}"
fi

if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR="outputs/train/${JOB_NAME}"
fi

TRAIN_ARGS=(
  dataset.repo_id="$DATASET_ID"
  policy.device="$DEVICE"
  job_name="$JOB_NAME"
  output_dir="$OUTPUT_DIR"
  wandb.enable="$WANDB_ENABLE"
  policy.push_to_hub="$PUSH_TO_HUB"
)

if [[ -n "$POLICY_REPO" ]]; then
  TRAIN_ARGS+=(policy.repo_id="$POLICY_REPO")
fi

if [[ -n "$BATCH_SIZE" ]]; then
  TRAIN_ARGS+=(batch_size="$BATCH_SIZE")
fi

if [[ -n "$STEPS" ]]; then
  TRAIN_ARGS+=(steps="$STEPS")
fi

if [[ -n "$SAVE_FREQ" ]]; then
  TRAIN_ARGS+=(save_freq="$SAVE_FREQ")
fi

if [[ -n "$LOG_FREQ" ]]; then
  TRAIN_ARGS+=(log_freq="$LOG_FREQ")
fi

if [[ -n "$EVAL_FREQ" ]]; then
  TRAIN_ARGS+=(eval_freq="$EVAL_FREQ")
fi

if [[ -n "$EVAL_BATCH" ]]; then
  TRAIN_ARGS+=(eval.batch_size="$EVAL_BATCH")
fi

if [[ -n "$EVAL_EPISODES" ]]; then
  TRAIN_ARGS+=(eval.n_episodes="$EVAL_EPISODES")
fi

if [[ -n "$NUM_WORKERS" ]]; then
  TRAIN_ARGS+=(num_workers="$NUM_WORKERS")
fi

if [[ -n "$ENV_TYPE" ]]; then
  TRAIN_ARGS+=(env.type="$ENV_TYPE")
fi

if [[ -n "$ENV_TASK" ]]; then
  TRAIN_ARGS+=(env.task="$ENV_TASK")
fi

if [[ -n "$ENV_EPISODE_LENGTH" ]]; then
  TRAIN_ARGS+=(env.episode_length="$ENV_EPISODE_LENGTH")
fi

if [[ -n "$DATASET_MODE" ]]; then
  TRAIN_ARGS+=(dataset.mode="$DATASET_MODE")
fi

if [[ -n "$DATASET_ROOT" ]]; then
  TRAIN_ARGS+=(dataset.root="$DATASET_ROOT")
fi

if [[ -n "$DATASET_EPISODES" ]]; then
  TRAIN_ARGS+=(dataset.episodes="$DATASET_EPISODES")
fi

TRAIN_ARGS+=("${POLICY_ARGS[@]}")

if [[ ${#EXTRA_ARGS[@]} -gt 0 ]]; then
  TRAIN_ARGS+=("${EXTRA_ARGS[@]}")
fi

if (( ACCELERATE_PROCS > 0 )); then
  require_cmd accelerate
  TRAIN_BIN=$(command -v lerobot-train)
  RUN_CMD=(accelerate launch --num_processes "$ACCELERATE_PROCS")
  if [[ ${#ACCELERATE_EXTRA[@]} -gt 0 ]]; then
    RUN_CMD+=("${ACCELERATE_EXTRA[@]}")
  fi
  RUN_CMD+=("$TRAIN_BIN")
else
  RUN_CMD=(lerobot-train)
fi

RUN_CMD+=("${TRAIN_ARGS[@]}")

printf 'Resolved command:\n  %s\n' "$(printf '%q ' "${RUN_CMD[@]}")"

if [[ "$DRY_RUN" == "true" ]]; then
  exit 0
fi


"${RUN_CMD[@]}"
