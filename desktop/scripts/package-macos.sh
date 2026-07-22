#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "${ROOT}"

BUILD_RUNTIME=0
FORCE_RUNTIME_BUILD=0

usage() {
  cat <<'EOF'
Usage: package-macos.sh [options]

Options:
  --build-runtime          Build the macOS LeRobot runtime when needed.
  --force-runtime-build    Rebuild the runtime archive before packaging.
  -h, --help               Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-runtime) BUILD_RUNTIME=1; shift ;;
    --force-runtime-build) BUILD_RUNTIME=1; FORCE_RUNTIME_BUILD=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

RUNTIME_ZIP="${ROOT}/src-tauri/resources/runtime/macos/lerobot-env-macos.zip"
if [[ "${BUILD_RUNTIME}" -eq 1 && "${FORCE_RUNTIME_BUILD}" -eq 1 && -f "${RUNTIME_ZIP}" ]]; then
  rm -f "${RUNTIME_ZIP}"
fi

if [[ ! -f "${RUNTIME_ZIP}" ]]; then
  if [[ -n "${ROBOTCLOUD_MACOS_RUNTIME_ZIP:-}" && -f "${ROBOTCLOUD_MACOS_RUNTIME_ZIP}" ]]; then
    mkdir -p "$(dirname "${RUNTIME_ZIP}")"
    cp "${ROBOTCLOUD_MACOS_RUNTIME_ZIP}" "${RUNTIME_ZIP}"
  else
    RUNTIME_BUILDER="${ROOT}/scripts/build-lerobot-runtime-mac.sh"
    if [[ ! -f "${RUNTIME_BUILDER}" ]]; then
      echo "Missing macOS runtime archive: ${RUNTIME_ZIP} and runtime builder script was not found: ${RUNTIME_BUILDER}" >&2
      exit 1
    fi

    builder_args=(--output-zip "${RUNTIME_ZIP}")
    if [[ "${FORCE_RUNTIME_BUILD}" -eq 1 ]]; then
      builder_args+=(--force)
    fi
    "${RUNTIME_BUILDER}" "${builder_args[@]}"
  fi
fi

# Stage VR-teleop artifacts (robot-service sidecar, meshes, descriptor) from
# the operator submodule; tauri.conf.json's externalBin/resources expect them.
bash "${ROOT}/scripts/build-robot-service.sh"

pnpm install
pnpm tauri build --bundles dmg --verbose
