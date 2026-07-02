#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

WORK_DIR=""
ENV_PATH=""
OUTPUT_ZIP=""
MICROMAMBA_EXE="${MICROMAMBA_EXE:-}"
MICROMAMBA_URL=""
PYTHON_VERSION="3.12"
LEROBOT_SPEC="lerobot==0.5.1"
TORCH_SPEC="torch==2.10.0"
TORCHVISION_SPEC="torchvision==0.25.0"
TORCH_INDEX_URL=""
EXTRA_PIP_PACKAGES=("feetech-servo-sdk>=1.0.0,<2.0.0")
FORCE=0
SKIP_SMOKE_TEST=0

usage() {
  cat <<'EOF'
Usage: build-lerobot-runtime-mac.sh [options]

Options:
  --work-dir PATH             Build workspace. Defaults to desktop/.runtime-build/macos.
  --env-path PATH             Runtime env path. Defaults to WORK_DIR/lerobot-env.
  --output-zip PATH           Output archive. Defaults to src-tauri/resources/runtime/macos/lerobot-env-macos.zip.
  --micromamba-exe PATH       Existing micromamba executable to use.
  --micromamba-url URL        Micromamba archive URL. Defaults to the current macOS CPU architecture.
  --python-version VERSION    Python version. Defaults to 3.12.
  --lerobot-spec SPEC         LeRobot pip requirement. Defaults to lerobot==0.5.1.
  --torch-spec SPEC           Torch pip requirement. Defaults to torch==2.10.0.
  --torchvision-spec SPEC     TorchVision pip requirement. Defaults to torchvision==0.25.0.
  --torch-index-url URL       Optional pip index URL for Torch/TorchVision. Defaults to PyPI on macOS.
  --extra-pip-package SPEC    Additional pip requirement. Can be repeated.
  --force                     Rebuild env and overwrite output zip.
  --skip-smoke-test           Skip import and lerobot-info checks.
  -h, --help                  Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --work-dir) WORK_DIR="$2"; shift 2 ;;
    --env-path) ENV_PATH="$2"; shift 2 ;;
    --output-zip) OUTPUT_ZIP="$2"; shift 2 ;;
    --micromamba-exe) MICROMAMBA_EXE="$2"; shift 2 ;;
    --micromamba-url) MICROMAMBA_URL="$2"; shift 2 ;;
    --python-version) PYTHON_VERSION="$2"; shift 2 ;;
    --lerobot-spec) LEROBOT_SPEC="$2"; shift 2 ;;
    --torch-spec) TORCH_SPEC="$2"; shift 2 ;;
    --torchvision-spec) TORCHVISION_SPEC="$2"; shift 2 ;;
    --torch-index-url) TORCH_INDEX_URL="$2"; shift 2 ;;
    --extra-pip-package) EXTRA_PIP_PACKAGES+=("$2"); shift 2 ;;
    --force) FORCE=1; shift ;;
    --skip-smoke-test) SKIP_SMOKE_TEST=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script must run on macOS because it builds the native macOS LeRobot runtime." >&2
  exit 1
fi

if [[ -z "${WORK_DIR}" ]]; then
  WORK_DIR="${ROOT}/.runtime-build/macos"
fi
if [[ -z "${ENV_PATH}" ]]; then
  ENV_PATH="${WORK_DIR}/lerobot-env"
fi
if [[ -z "${OUTPUT_ZIP}" ]]; then
  OUTPUT_ZIP="${ROOT}/src-tauri/resources/runtime/macos/lerobot-env-macos.zip"
fi
if [[ -z "${MICROMAMBA_EXE}" ]] && command -v micromamba >/dev/null 2>&1; then
  MICROMAMBA_EXE=$(command -v micromamba)
fi
if [[ -z "${MICROMAMBA_EXE}" ]]; then
  MICROMAMBA_EXE="${WORK_DIR}/micromamba/bin/micromamba"
fi
if [[ -z "${MICROMAMBA_URL}" ]]; then
  case "$(uname -m)" in
    arm64|aarch64) MICROMAMBA_URL="https://micro.mamba.pm/api/micromamba/osx-arm64/latest" ;;
    x86_64|amd64) MICROMAMBA_URL="https://micro.mamba.pm/api/micromamba/osx-64/latest" ;;
    *) echo "Unsupported macOS CPU architecture: $(uname -m)" >&2; exit 1 ;;
  esac
fi

abspath() {
  local path="$1"
  if [[ "${path}" == /* ]]; then
    printf '%s\n' "${path}"
  else
    printf '%s\n' "${PWD}/${path#./}"
  fi
}

WORK_DIR=$(abspath "${WORK_DIR}")
ENV_PATH=$(abspath "${ENV_PATH}")
OUTPUT_ZIP=$(abspath "${OUTPUT_ZIP}")
MICROMAMBA_EXE=$(abspath "${MICROMAMBA_EXE}")

export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8
export PYTHONNOUSERSITE=1
export PIP_DISABLE_PIP_VERSION_CHECK=1
export PIP_NO_INPUT=1
export MAMBA_ROOT_PREFIX="${MAMBA_ROOT_PREFIX:-${WORK_DIR}/micromamba-root}"

run_checked() {
  echo "> $*"
  "$@"
}

assert_child_path() {
  local child
  local parent
  child=$(abspath "$1")
  parent=$(abspath "$2")
  if [[ "${child}" != "${parent}" && "${child}" != "${parent}/"* ]]; then
    echo "Refusing to modify path outside build workspace: ${child}" >&2
    exit 1
  fi
}

install_micromamba() {
  if [[ -x "${MICROMAMBA_EXE}" ]]; then
    return
  fi

  assert_child_path "${MICROMAMBA_EXE}" "${WORK_DIR}"
  mkdir -p "$(dirname "${MICROMAMBA_EXE}")"

  local archive="${WORK_DIR}/micromamba.tar.bz2"
  local extract_dir="${WORK_DIR}/micromamba-download"
  rm -rf "${extract_dir}"
  mkdir -p "${extract_dir}"

  echo "Downloading micromamba from ${MICROMAMBA_URL}"
  run_checked curl --fail --location --output "${archive}" "${MICROMAMBA_URL}"
  run_checked tar -xjf "${archive}" -C "${extract_dir}"

  local downloaded
  downloaded=$(find "${extract_dir}" -type f -name micromamba -print -quit)
  if [[ -z "${downloaded}" ]]; then
    echo "Downloaded micromamba archive did not contain micromamba" >&2
    exit 1
  fi

  cp "${downloaded}" "${MICROMAMBA_EXE}"
  chmod +x "${MICROMAMBA_EXE}"
}

new_runtime_env() {
  local python="${ENV_PATH}/bin/python"
  if [[ -x "${python}" && "${FORCE}" -ne 1 ]]; then
    echo "Reusing existing runtime environment: ${ENV_PATH}"
    return
  fi

  if [[ -e "${ENV_PATH}" && "${FORCE}" -eq 1 ]]; then
    assert_child_path "${ENV_PATH}" "${WORK_DIR}"
    rm -rf "${ENV_PATH}"
  fi

  mkdir -p "${WORK_DIR}"
  run_checked "${MICROMAMBA_EXE}" create -y -p "${ENV_PATH}" -c conda-forge "python=${PYTHON_VERSION}" pip

  if [[ ! -x "${python}" ]]; then
    echo "Python was not created at ${python}" >&2
    exit 1
  fi

  run_checked "${python}" -m pip install --upgrade pip setuptools wheel

  local torch_args=("-m" "pip" "install")
  if [[ -n "${TORCH_INDEX_URL}" ]]; then
    torch_args+=("--index-url" "${TORCH_INDEX_URL}")
  fi
  torch_args+=("${TORCH_SPEC}" "${TORCHVISION_SPEC}")
  run_checked "${python}" "${torch_args[@]}"

  local lerobot_args=("-m" "pip" "install" "${LEROBOT_SPEC}")
  if [[ "${#EXTRA_PIP_PACKAGES[@]}" -gt 0 ]]; then
    lerobot_args+=("${EXTRA_PIP_PACKAGES[@]}")
  fi
  run_checked "${python}" "${lerobot_args[@]}"
}

normalize_entrypoint_shebangs() {
  local bin_dir="${ENV_PATH}/bin"
  if [[ ! -d "${bin_dir}" ]]; then
    return
  fi

  for file in "${bin_dir}"/*; do
    [[ -f "${file}" ]] || continue
    if ! LC_ALL=C head -c 2 "${file}" 2>/dev/null | grep -q '^#!'; then
      continue
    fi

    local first_line
    first_line=$(LC_ALL=C sed -n '1p' "${file}")
    if [[ "${first_line}" != *python* ]]; then
      continue
    fi

    local mode
    local temp
    mode=$(stat -f '%Lp' "${file}")
    temp="${file}.tmp"
    {
      printf '#!/usr/bin/env python\n'
      tail -n +2 "${file}"
    } > "${temp}"
    chmod "${mode}" "${temp}"
    mv "${temp}" "${file}"
  done
}

remove_runtime_build_junk() {
  echo "Cleaning Python caches from runtime environment"
  find "${ENV_PATH}" -type d -name "__pycache__" -prune -exec rm -rf {} +
  find "${ENV_PATH}" -type f \( -name "*.pyc" -o -name "*.pyo" \) -delete
  find "${ENV_PATH}" -type d -name ".pytest_cache" -prune -exec rm -rf {} +
}

test_runtime_env() {
  local python="${ENV_PATH}/bin/python"
  local lerobot_info="${ENV_PATH}/bin/lerobot-info"
  if [[ ! -x "${python}" ]]; then
    echo "Missing runtime Python: ${python}" >&2
    exit 1
  fi
  if [[ ! -x "${lerobot_info}" ]]; then
    echo "Missing lerobot-info entrypoint: ${lerobot_info}" >&2
    exit 1
  fi

  if [[ "${SKIP_SMOKE_TEST}" -ne 1 ]]; then
    run_checked "${python}" -c "import lerobot, torch, torchvision, serial, scservo_sdk; print('runtime imports ok')"
    PATH="${ENV_PATH}/bin:${PATH}" run_checked "${lerobot_info}"
  fi
}

write_runtime_manifest() {
  local python="${ENV_PATH}/bin/python"
  local manifest_path="${ENV_PATH}/ROBOTCLOUD_RUNTIME_MANIFEST.json"
  MANIFEST_PATH="${manifest_path}" \
  MANIFEST_PLATFORM="macos" \
  MANIFEST_PYTHON_VERSION="${PYTHON_VERSION}" \
  MANIFEST_LEROBOT_SPEC="${LEROBOT_SPEC}" \
  MANIFEST_TORCH_SPEC="${TORCH_SPEC}" \
  MANIFEST_TORCHVISION_SPEC="${TORCHVISION_SPEC}" \
  MANIFEST_TORCH_INDEX_URL="${TORCH_INDEX_URL}" \
  "${python}" - <<'PY'
import datetime
import json
import os
import subprocess
import sys

packages = subprocess.check_output(
    [sys.executable, "-m", "pip", "freeze"],
    text=True,
).splitlines()
manifest = {
    "createdAt": datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z"),
    "platform": os.environ["MANIFEST_PLATFORM"],
    "pythonVersion": os.environ["MANIFEST_PYTHON_VERSION"],
    "lerobotSpec": os.environ["MANIFEST_LEROBOT_SPEC"],
    "torchSpec": os.environ["MANIFEST_TORCH_SPEC"],
    "torchVisionSpec": os.environ["MANIFEST_TORCHVISION_SPEC"],
    "torchIndexUrl": os.environ["MANIFEST_TORCH_INDEX_URL"],
    "packages": packages,
}
with open(os.environ["MANIFEST_PATH"], "w", encoding="utf-8") as handle:
    json.dump(manifest, handle, indent=2)
    handle.write("\n")
PY
}

new_zip_from_directory_contents() {
  local source_dir="$1"
  local zip_path="$2"
  local zip_parent
  local temp_zip

  if ! command -v zip >/dev/null 2>&1; then
    echo "zip is required to create ${zip_path}" >&2
    exit 1
  fi

  zip_parent=$(dirname "${zip_path}")
  mkdir -p "${zip_parent}"
  temp_zip="${zip_path}.partial"
  rm -f "${temp_zip}"
  if [[ -e "${zip_path}" ]]; then
    if [[ "${FORCE}" -ne 1 ]]; then
      echo "Output already exists: ${zip_path}. Use --force to overwrite it." >&2
      exit 1
    fi
    rm -f "${zip_path}"
  fi

  echo "Creating runtime archive: ${zip_path}"
  (
    cd "${source_dir}"
    zip -qry -y "${temp_zip}" .
  )
  mv "${temp_zip}" "${zip_path}"
}

mkdir -p "${WORK_DIR}"
install_micromamba
new_runtime_env
normalize_entrypoint_shebangs
test_runtime_env
write_runtime_manifest
remove_runtime_build_junk
new_zip_from_directory_contents "${ENV_PATH}" "${OUTPUT_ZIP}"

echo "macOS LeRobot runtime archive ready: ${OUTPUT_ZIP}"
