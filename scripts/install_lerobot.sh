#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
LEROBOT_DIR=${LEROBOT_DIR:-"${ROOT_DIR}/lerobot"}
PY_VERSION="3.10"
VENV_DIR=${VENV_DIR:-"${LEROBOT_DIR}/.venv"}
INSTALL_SYSTEM_DEPS=${INSTALL_SYSTEM_DEPS:-"0"}
INSTALL_GAMEPAD_EXTRA=${INSTALL_GAMEPAD_EXTRA:-"1"}

log() {
  printf "[lerobot-install] %s\n" "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "Missing required command: $1"
    return 1
  fi
  return 0
}

install_uv_if_missing() {
  if command -v uv >/dev/null 2>&1; then
    return 0
  fi

  log "uv not found; attempting to install"

  if command -v curl >/dev/null 2>&1; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
    if [[ -d "${HOME}/.cargo/bin" ]]; then
      export PATH="${HOME}/.cargo/bin:${PATH}"
    fi
    if [[ -d "${HOME}/.local/bin" ]]; then
      export PATH="${HOME}/.local/bin:${PATH}"
    fi
  else
    log "Cannot install uv automatically (missing curl)."
    return 1
  fi

  if ! command -v uv >/dev/null 2>&1; then
    log "uv install failed or not on PATH."
    return 1
  fi
}

ensure_macos_developer_tools() {
  if [[ "$(uname)" != "Darwin" ]]; then
    return 0
  fi

  if xcode-select -p >/dev/null 2>&1; then
    return 0
  fi

  log "Xcode Command Line Tools not found; attempting to install"
  if xcode-select --install >/dev/null 2>&1; then
    true
  fi

  local waited=0
  local max_wait=1800
  local step=10

  while ! xcode-select -p >/dev/null 2>&1; do
    if (( waited >= max_wait )); then
      log "Xcode Command Line Tools install timed out. Please finish installation, then re-run."
      return 1
    fi
    sleep "${step}"
    waited=$((waited + step))
  done
}

install_system_deps() {
  if [[ "${INSTALL_SYSTEM_DEPS}" != "1" ]]; then
    return 0
  fi

  if [[ "$(uname)" == "Darwin" ]]; then
    if command -v brew >/dev/null 2>&1; then
      brew install ffmpeg
    else
      log "Homebrew not found; skipping ffmpeg install."
    fi
  elif [[ "$(uname)" == "Linux" ]]; then
    if command -v apt-get >/dev/null 2>&1; then
      sudo apt-get update
      sudo apt-get install -y \
        cmake build-essential python3-dev pkg-config \
        libavformat-dev libavcodec-dev libavdevice-dev libavutil-dev \
        libswscale-dev libswresample-dev libavfilter-dev ffmpeg
    else
      log "apt-get not found; skipping system deps."
    fi
  fi
}

clone_lerobot() {
  if [[ -d "${LEROBOT_DIR}/.git" ]]; then
    log "LeRobot repo already exists at ${LEROBOT_DIR}"
    return 0
  fi

  mkdir -p "${LEROBOT_DIR%/*}"
  git clone https://github.com/huggingface/lerobot.git "${LEROBOT_DIR}"
}

create_venv() {
  if [[ -x "${VENV_DIR}/bin/python" ]]; then
    log "Using existing venv at ${VENV_DIR}"
    return 0
  fi

  uv venv --python "${PY_VERSION}" "${VENV_DIR}"
}

install_torch() {
  local py="${VENV_DIR}/bin/python"

  # Use CPU wheels by default; users can override with FORCE_TORCH_INDEX_URL
  if [[ -n "${FORCE_TORCH_INDEX_URL:-}" ]]; then
    uv pip install --python "${py}" torch torchvision --index-url "${FORCE_TORCH_INDEX_URL}"
  else
    uv pip install --python "${py}" torch torchvision
  fi
}

install_lerobot() {
  local py="${VENV_DIR}/bin/python"
  local extras="feetech"

  if [[ "${INSTALL_GAMEPAD_EXTRA}" == "1" ]]; then
    extras="${extras},gamepad,async"
  fi

  pushd "${LEROBOT_DIR}" >/dev/null
  uv pip install --python "${py}" -e ".[${extras}]"
  popd >/dev/null
}

verify_commands() {
  local bin="${VENV_DIR}/bin"
  local cmds=(
    lerobot-setup-motors
    lerobot-calibrate
    lerobot-teleoperate
    lerobot-record
    lerobot-replay
  )

  for cmd in "${cmds[@]}"; do
    if [[ ! -x "${bin}/${cmd}" ]]; then
      log "Expected command not found: ${bin}/${cmd}"
      return 1
    fi
    "${bin}/${cmd}" --help >/dev/null
  done
}

main() {
  require_cmd git
  ensure_macos_developer_tools
  install_uv_if_missing
  install_system_deps
  clone_lerobot
  create_venv
  install_torch
  install_lerobot
  verify_commands
  log "Done. Activate with: source ${VENV_DIR}/bin/activate"
}

main "$@"
