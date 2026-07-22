#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "${ROOT}"

RUNTIME_ZIP="${ROOT}/src-tauri/resources/runtime/linux/lerobot-env-linux.zip"
if [[ ! -f "${RUNTIME_ZIP}" ]]; then
  if [[ -n "${ROBOTCLOUD_LINUX_RUNTIME_ZIP:-}" && -f "${ROBOTCLOUD_LINUX_RUNTIME_ZIP}" ]]; then
    mkdir -p "$(dirname "${RUNTIME_ZIP}")"
    cp "${ROBOTCLOUD_LINUX_RUNTIME_ZIP}" "${RUNTIME_ZIP}"
  else
    echo "Missing Linux runtime archive: ${RUNTIME_ZIP}" >&2
    echo "Set ROBOTCLOUD_LINUX_RUNTIME_ZIP to a local lerobot-env-linux.zip release artifact before building." >&2
    exit 1
  fi
fi

BUNDLES=${ROBOTCLOUD_LINUX_BUNDLES:-deb,rpm,appimage}

# Stage VR-teleop artifacts (robot-service sidecar, meshes, descriptors) from
# the operator submodule; tauri.conf.json's externalBin/resources expect them.
bash "${ROOT}/scripts/build-robot-service.sh"

pnpm install
pnpm tauri build --bundles "${BUNDLES}"
