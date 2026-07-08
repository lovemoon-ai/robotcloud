#!/usr/bin/env bash
set -euo pipefail

ACTION="info"
FOLLOWER_PORT=""
LEADER_PORT=""
CAMERA_ID=""
CAMERA_CONFIG_OVERRIDE=""
CAMERA_INDEX="0"
WIDTH="640"
HEIGHT="480"
FPS="30"
ROBOT_ID="so101_follower"
TELEOP_ID="so101_leader"
DATASET_REPO_ID="local/so101_desktop"
DATASET_ROOT=""
EPISODES="1"
EPISODE_TIME_S="10"
MIN_EPISODE_TIME_S="2"
MAX_EPISODE_TIME_S="60"
RESET_TIME_S="2"
TASK="SO-101 desktop teleoperation"
TELEOP_TIME_S="5"
MAX_RELATIVE_TARGET="5"
DISPLAY_DATA="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --action) ACTION="$2"; shift 2 ;;
    --follower-port) FOLLOWER_PORT="$2"; shift 2 ;;
    --leader-port) LEADER_PORT="$2"; shift 2 ;;
    --camera-id) CAMERA_ID="$2"; shift 2 ;;
    --camera-config) CAMERA_CONFIG_OVERRIDE="$2"; shift 2 ;;
    --camera-index) CAMERA_INDEX="$2"; shift 2 ;;
    --width) WIDTH="$2"; shift 2 ;;
    --height) HEIGHT="$2"; shift 2 ;;
    --fps) FPS="$2"; shift 2 ;;
    --robot-id) ROBOT_ID="$2"; shift 2 ;;
    --teleop-id) TELEOP_ID="$2"; shift 2 ;;
    --dataset-repo-id) DATASET_REPO_ID="$2"; shift 2 ;;
    --dataset-root) DATASET_ROOT="$2"; shift 2 ;;
    --episodes) EPISODES="$2"; shift 2 ;;
    --episode-time-s) EPISODE_TIME_S="$2"; shift 2 ;;
    --min-episode-time-s) MIN_EPISODE_TIME_S="$2"; shift 2 ;;
    --max-episode-time-s) MAX_EPISODE_TIME_S="$2"; shift 2 ;;
    --reset-time-s) RESET_TIME_S="$2"; shift 2 ;;
    --task) TASK="$2"; shift 2 ;;
    --teleop-time-s) TELEOP_TIME_S="$2"; shift 2 ;;
    --max-relative-target) MAX_RELATIVE_TARGET="$2"; shift 2 ;;
    --display-data) DISPLAY_DATA="true"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RESOURCE_ROOT=$(cd "${SCRIPT_DIR}/.." && pwd)
PLATFORM_DIR="linux"
if [[ "$(uname)" == "Darwin" ]]; then
  PLATFORM_DIR="macos"
fi

ENV_PATH=${ROBOTCLOUD_LEROBOT_ENV:-"${RESOURCE_ROOT}/runtime/${PLATFORM_DIR}/lerobot-env"}
PYTHON="${ENV_PATH}/bin/python"
BIN="${ENV_PATH}/bin"
SHIMS="${ENV_PATH}/robotcloud-shims"

if [[ ! -x "${PYTHON}" ]]; then
  echo "LeRobot environment was not found at ${ENV_PATH}" >&2
  exit 1
fi

export PATH="${SHIMS}:${BIN}:${PATH}"
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8
export PYTHONNOUSERSITE=1

DATA_DIR=${ROBOTCLOUD_DATA_DIR:-"${HOME}/.robotcloud/so101-data"}
mkdir -p "${DATA_DIR}"
if [[ -z "${DATASET_ROOT}" ]]; then
  DATASET_ROOT="${DATA_DIR}/datasets/${DATASET_REPO_ID}"
fi

require_port() {
  local value="$1"
  local name="$2"
  if [[ -z "${value}" ]]; then
    echo "${name} is required." >&2
    exit 1
  fi
}

run_lerobot() {
  local tool="$1"
  shift
  # Invoke via `python -m` instead of the console-script entrypoint (e.g. lerobot-info),
  # so we never depend on the packaged shebang being relocatable. Mirrors so101.ps1.
  # tool "lerobot-info" -> module "lerobot.scripts.lerobot_info"
  local module="lerobot.scripts.${tool//-/_}"
  echo "> ${PYTHON} -m ${module} $*"
  "${PYTHON}" -m "${module}" "$@"
}

run_robotcloud_python() {
  local script="$1"
  shift
  echo "> ${PYTHON} ${SCRIPT_DIR}/${script} $*"
  "${PYTHON}" "${SCRIPT_DIR}/${script}" "$@"
}

json_detect_ports() {
  "${PYTHON}" - <<'PY'
import json
import re
from serial.tools import list_ports

try:
    from lerobot.scripts.lerobot_find_port import find_available_ports
except Exception:
    find_available_ports = None

def is_candidate(device="", description="", manufacturer="", hwid=""):
    text = " ".join(str(value or "") for value in (device, description, manufacturer, hwid)).lower()
    if "bluetooth" in text or "debug-console" in text:
        return False
    if re.fullmatch(r"com\d+", str(device or "").lower()):
        return True
    return any(token in text for token in ("usb", "acm", "serial", "ch340", "cp210", "ftdi", "wch"))

lerobot_ports = find_available_ports() if find_available_ports else []
items = []
seen = set()
for port in list_ports.comports():
    device = port.device
    if not is_candidate(device, port.description, port.manufacturer, port.hwid):
        continue
    seen.add(device)
    items.append({
        "device": device,
        "name": port.name,
        "description": port.description,
        "manufacturer": port.manufacturer,
        "hwid": port.hwid,
    })
for device in lerobot_ports:
    if device not in seen and is_candidate(device):
        items.append({"device": device})
print("LeRobot find-port USB serial candidates:")
for item in items:
    detail = " - ".join(str(item.get(key) or "") for key in ("description", "manufacturer", "hwid")).strip(" -")
    print(f"  {item['device']}" + (f" ({detail})" if detail else ""))
print("ROBOTCLOUD_PORTS_JSON=" + json.dumps(items, ensure_ascii=False))
PY
}

json_detect_cameras() {
  "${PYTHON}" - "${DATA_DIR}/captured_images" <<'PY'
import json
import sys
from pathlib import Path

output_dir = Path(sys.argv[1])
try:
    from lerobot.scripts.lerobot_find_cameras import find_and_print_cameras
except Exception as exc:
    raise SystemExit(f"Could not import lerobot camera finder: {exc}")

cameras = find_and_print_cameras("opencv")
output_dir.mkdir(parents=True, exist_ok=True)
print("ROBOTCLOUD_CAMERAS_JSON=" + json.dumps(cameras, ensure_ascii=False, default=str))
PY
}

camera_ref_for_config() {
  local value="${CAMERA_ID:-${CAMERA_INDEX}}"
  if [[ "${value}" =~ ^[0-9]+$ ]]; then
    printf '%s' "${value}"
    return
  fi
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  printf '"%s"' "${value}"
}

CAMERA_CONFIG="{ front: {type: opencv, index_or_path: $(camera_ref_for_config), width: ${WIDTH}, height: ${HEIGHT}, fps: ${FPS}}}"
if [[ -n "${CAMERA_CONFIG_OVERRIDE}" ]]; then
  CAMERA_CONFIG="${CAMERA_CONFIG_OVERRIDE}"
fi

case "${ACTION}" in
  info)
    run_lerobot lerobot-info
    ;;
  ports|find-port)
    json_detect_ports
    ;;
  cameras)
    json_detect_cameras
    ;;
  setup-follower)
    require_port "${FOLLOWER_PORT}" "follower port"
    run_lerobot lerobot-setup-motors --robot.type=so101_follower --robot.port="${FOLLOWER_PORT}" --robot.id="${ROBOT_ID}"
    ;;
  setup-leader)
    require_port "${LEADER_PORT}" "leader port"
    run_lerobot lerobot-setup-motors --teleop.type=so101_leader --teleop.port="${LEADER_PORT}" --teleop.id="${TELEOP_ID}"
    ;;
  calibrate-follower)
    require_port "${FOLLOWER_PORT}" "follower port"
    run_lerobot lerobot-calibrate --robot.type=so101_follower --robot.port="${FOLLOWER_PORT}" --robot.id="${ROBOT_ID}"
    ;;
  calibrate-leader)
    require_port "${LEADER_PORT}" "leader port"
    run_lerobot lerobot-calibrate --teleop.type=so101_leader --teleop.port="${LEADER_PORT}" --teleop.id="${TELEOP_ID}"
    ;;
  teleop)
    require_port "${FOLLOWER_PORT}" "follower port"
    require_port "${LEADER_PORT}" "leader port"
    run_lerobot lerobot-teleoperate \
      --robot.type=so101_follower \
      --robot.port="${FOLLOWER_PORT}" \
      --robot.id="${ROBOT_ID}" \
      --teleop.type=so101_leader \
      --teleop.port="${LEADER_PORT}" \
      --teleop.id="${TELEOP_ID}"
    ;;
  save-pose|record-reset-pose)
    require_port "${FOLLOWER_PORT}" "follower port"
    require_port "${LEADER_PORT}" "leader port"
    run_robotcloud_python robotcloud_save_pose.py \
      --robot.type=so101_follower \
      --robot.port="${FOLLOWER_PORT}" \
      --robot.id="${ROBOT_ID}" \
      --robot.max_relative_target="${MAX_RELATIVE_TARGET}" \
      --teleop.type=so101_leader \
      --teleop.port="${LEADER_PORT}" \
      --teleop.id="${TELEOP_ID}" \
      --fps="${FPS}"
    ;;
  record-auto)
    require_port "${FOLLOWER_PORT}" "follower port"
    require_port "${LEADER_PORT}" "leader port"
    mkdir -p "$(dirname "${DATASET_ROOT}")"
    run_robotcloud_python robotcloud_auto_record.py \
      --robot.type=so101_follower \
      --robot.port="${FOLLOWER_PORT}" \
      --robot.cameras="${CAMERA_CONFIG}" \
      --robot.id="${ROBOT_ID}" \
      --robot.max_relative_target="${MAX_RELATIVE_TARGET}" \
      --teleop.type=so101_leader \
      --teleop.port="${LEADER_PORT}" \
      --teleop.id="${TELEOP_ID}" \
      --dataset.repo_id="${DATASET_REPO_ID}" \
      --dataset.root="${DATASET_ROOT}" \
      --dataset.num_episodes="${EPISODES}" \
      --dataset.single_task="${TASK}" \
      --dataset.push_to_hub=false \
      --dataset.streaming_encoding=true \
      --dataset.encoder_threads=2 \
      --dataset.vcodec=h264 \
      --min_episode_time_s="${MIN_EPISODE_TIME_S}" \
      --max_episode_time_s="${MAX_EPISODE_TIME_S}" \
      --display_data="${DISPLAY_DATA}"
    ;;
  record)
    require_port "${FOLLOWER_PORT}" "follower port"
    require_port "${LEADER_PORT}" "leader port"
    mkdir -p "$(dirname "${DATASET_ROOT}")"
    run_lerobot lerobot-record \
      --robot.type=so101_follower \
      --robot.port="${FOLLOWER_PORT}" \
      --robot.cameras="${CAMERA_CONFIG}" \
      --robot.id="${ROBOT_ID}" \
      --robot.max_relative_target="${MAX_RELATIVE_TARGET}" \
      --teleop.type=so101_leader \
      --teleop.port="${LEADER_PORT}" \
      --teleop.id="${TELEOP_ID}" \
      --dataset.repo_id="${DATASET_REPO_ID}" \
      --dataset.root="${DATASET_ROOT}" \
      --dataset.num_episodes="${EPISODES}" \
      --dataset.episode_time_s="${EPISODE_TIME_S}" \
      --dataset.reset_time_s="${RESET_TIME_S}" \
      --dataset.single_task="${TASK}" \
      --dataset.push_to_hub=false \
      --dataset.streaming_encoding=true \
      --dataset.encoder_threads=2 \
      --dataset.vcodec=h264 \
      --display_data="${DISPLAY_DATA}"
    ;;
  *)
    echo "Unsupported action: ${ACTION}" >&2
    exit 2
    ;;
esac
