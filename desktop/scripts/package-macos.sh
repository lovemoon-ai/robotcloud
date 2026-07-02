#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "${ROOT}"

RUNTIME_ZIP="${ROOT}/src-tauri/resources/runtime/macos/lerobot-env-macos.zip"
if [[ ! -f "${RUNTIME_ZIP}" ]]; then
  if [[ -n "${ROBOTCLOUD_MACOS_RUNTIME_ZIP:-}" && -f "${ROBOTCLOUD_MACOS_RUNTIME_ZIP}" ]]; then
    mkdir -p "$(dirname "${RUNTIME_ZIP}")"
    cp "${ROBOTCLOUD_MACOS_RUNTIME_ZIP}" "${RUNTIME_ZIP}"
  else
    echo "Missing macOS runtime archive: ${RUNTIME_ZIP}" >&2
    echo "Set ROBOTCLOUD_MACOS_RUNTIME_ZIP to a local lerobot-env-macos.zip release artifact before building." >&2
    exit 1
  fi
fi

pnpm install
pnpm tauri build --bundles dmg
