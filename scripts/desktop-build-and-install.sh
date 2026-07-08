#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"
DESKTOP_DIR="${PROJECT_ROOT}/desktop"
BUNDLE_DIR="${DESKTOP_DIR}/src-tauri/target/release/bundle"
APP_ID="top.conductor-ai.robotcloud.desktop"

SKIP_BUILD=0
SKIP_INSTALL=0
BUILD_RUNTIME=0
FORCE_RUNTIME_BUILD=0

usage() {
  cat <<'EOF'
Usage: scripts/desktop-build-and-install.sh [options]

Build RobotCloud Desktop for the current macOS/Linux host and install it.

Options:
  --skip-build             Install the newest existing bundle without rebuilding.
  --no-install             Build only; do not install.
  --build-runtime          macOS: build the LeRobot runtime when needed.
  --force-runtime-build    macOS: rebuild the LeRobot runtime before packaging.
  -h, --help               Show this help.

Environment:
  ROBOTCLOUD_MACOS_RUNTIME_ZIP=/path/to/lerobot-env-macos.zip
  ROBOTCLOUD_LINUX_RUNTIME_ZIP=/path/to/lerobot-env-linux.zip
  ROBOTCLOUD_LINUX_BUNDLES=deb,rpm,appimage
EOF
}

log() {
  printf '[desktop-install] %s\n' "$*"
}

die() {
  printf '[desktop-install] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

mtime() {
  if stat -f '%m' "$1" >/dev/null 2>&1; then
    stat -f '%m' "$1"
  else
    stat -c '%Y' "$1"
  fi
}

latest_path() {
  local root="$1"
  local kind="$2"
  local pattern="$3"

  [[ -d "${root}" ]] || return 0
  find "${root}" -type "${kind}" -name "${pattern}" -print 2>/dev/null |
    while IFS= read -r path; do
      printf '%s\t%s\n' "$(mtime "${path}")" "${path}"
    done |
    sort -rn |
    head -n 1 |
    cut -f 2-
}

sudo_if_needed() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

stop_desktop_app() {
  case "$(uname -s)" in
    Darwin)
      if pgrep -x robotcloud >/dev/null 2>&1 || pgrep -f '/RobotCloud\.app/Contents/MacOS/robotcloud' >/dev/null 2>&1; then
        log "Stopping running RobotCloud desktop processes"
        pkill -x robotcloud >/dev/null 2>&1 || true
        pkill -f '/RobotCloud\.app/Contents/MacOS/robotcloud' >/dev/null 2>&1 || true
        sleep 1
      fi
      ;;
    Linux)
      if pgrep -x robotcloud >/dev/null 2>&1; then
        log "Stopping running RobotCloud desktop processes"
        pkill -x robotcloud >/dev/null 2>&1 || true
        sleep 1
      fi
      ;;
  esac
}

remove_cache_path() {
  local path="$1"
  [[ -n "${path}" && -e "${path}" ]] || return 0
  log "Removing cache: ${path}"
  rm -rf "${path}"
}

clear_desktop_caches() {
  stop_desktop_app
  case "$(uname -s)" in
    Darwin)
      remove_cache_path "${HOME}/Library/Caches/${APP_ID}"
      remove_cache_path "${HOME}/Library/WebKit/${APP_ID}"
      remove_cache_path "${HOME}/Library/HTTPStorages/${APP_ID}"
      remove_cache_path "${HOME}/Library/HTTPStorages/${APP_ID}.binarycookies"
      remove_cache_path "${HOME}/Library/Saved Application State/${APP_ID}.savedState"
      ;;
    Linux)
      local cache_home="${XDG_CACHE_HOME:-${HOME}/.cache}"
      remove_cache_path "${cache_home}/${APP_ID}"
      remove_cache_path "${cache_home}/tauri/${APP_ID}"
      remove_cache_path "${cache_home}/webkitgtk/${APP_ID}"
      ;;
  esac
}

install_macos_app() {
  local app_path="$1"
  local install_root="${ROBOTCLOUD_MACOS_INSTALL_DIR:-/Applications}"
  local dest="${install_root}/$(basename "${app_path}")"

  log "Installing $(basename "${app_path}") to ${install_root}"
  if [[ -w "${install_root}" ]]; then
    rm -rf "${dest}"
    ditto "${app_path}" "${dest}"
    xattr -dr com.apple.quarantine "${dest}" >/dev/null 2>&1 || true
  else
    sudo_if_needed rm -rf "${dest}"
    sudo_if_needed ditto "${app_path}" "${dest}"
    sudo_if_needed xattr -dr com.apple.quarantine "${dest}" >/dev/null 2>&1 || true
  fi

  log "Installed: ${dest}"
}

install_macos_dmg() {
  local dmg_path="$1"
  local mount_dir
  local mounted_app

  mount_dir="$(mktemp -d "${TMPDIR:-/tmp}/robotcloud-dmg.XXXXXX")"
  log "Mounting ${dmg_path}"
  hdiutil attach "${dmg_path}" -mountpoint "${mount_dir}" -nobrowse -quiet
  trap 'hdiutil detach "${mount_dir}" -quiet >/dev/null 2>&1 || true; rmdir "${mount_dir}" >/dev/null 2>&1 || true' EXIT

  mounted_app="$(latest_path "${mount_dir}" d '*.app')"
  [[ -n "${mounted_app}" ]] || die "No .app bundle found inside ${dmg_path}"
  install_macos_app "${mounted_app}"

  hdiutil detach "${mount_dir}" -quiet
  rmdir "${mount_dir}" >/dev/null 2>&1 || true
  trap - EXIT
}

build_macos() {
  require_command pnpm
  require_command cargo
  require_command hdiutil
  require_command ditto

  if [[ "${SKIP_BUILD}" -eq 1 ]]; then
    log "Skipping macOS build"
    return
  fi

  local args=()
  [[ "${BUILD_RUNTIME}" -eq 1 ]] && args+=(--build-runtime)
  [[ "${FORCE_RUNTIME_BUILD}" -eq 1 ]] && args+=(--force-runtime-build)

  log "Building macOS desktop package"
  if [[ "${#args[@]}" -gt 0 ]]; then
    "${DESKTOP_DIR}/scripts/package-macos.sh" "${args[@]}"
  else
    "${DESKTOP_DIR}/scripts/package-macos.sh"
  fi
}

install_macos() {
  local app_path
  local dmg_path

  app_path="$(latest_path "${BUNDLE_DIR}/macos" d '*.app')"
  if [[ -n "${app_path}" ]]; then
    install_macos_app "${app_path}"
    return
  fi

  dmg_path="$(latest_path "${BUNDLE_DIR}/dmg" f '*.dmg')"
  [[ -n "${dmg_path}" ]] || die "No macOS .app or .dmg bundle found under ${BUNDLE_DIR}"
  install_macos_dmg "${dmg_path}"
}

build_linux() {
  require_command pnpm
  require_command cargo

  if [[ "${SKIP_BUILD}" -eq 1 ]]; then
    log "Skipping Linux build"
    return
  fi

  log "Building Linux desktop package"
  "${DESKTOP_DIR}/scripts/package-linux.sh"
}

install_linux_deb() {
  local deb_path="$1"

  require_command sudo
  require_command dpkg
  log "Installing Debian package ${deb_path}"
  if ! sudo dpkg -i "${deb_path}"; then
    if command -v apt-get >/dev/null 2>&1; then
      sudo apt-get install -f -y
    else
      die "dpkg install failed and apt-get is unavailable"
    fi
  fi
}

install_linux_rpm() {
  local rpm_path="$1"

  require_command sudo
  log "Installing RPM package ${rpm_path}"
  if command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y "${rpm_path}"
  elif command -v yum >/dev/null 2>&1; then
    sudo yum install -y "${rpm_path}"
  elif command -v rpm >/dev/null 2>&1; then
    sudo rpm -Uvh --replacepkgs "${rpm_path}"
  else
    die "No RPM installer found; expected dnf, yum, or rpm"
  fi
}

install_linux_appimage() {
  local appimage_path="$1"
  local bin_dir="${ROBOTCLOUD_APPIMAGE_BIN_DIR:-${HOME}/.local/bin}"
  local app_dir="${HOME}/.local/share/applications"
  local icon_path="${DESKTOP_DIR}/src-tauri/icons/icon.png"
  local target="${bin_dir}/robotcloud-desktop.AppImage"
  local desktop_file="${app_dir}/robotcloud.desktop"

  log "Installing AppImage to ${target}"
  mkdir -p "${bin_dir}" "${app_dir}"
  cp "${appimage_path}" "${target}"
  chmod +x "${target}"

  cat > "${desktop_file}" <<EOF
[Desktop Entry]
Type=Application
Name=RobotCloud
Exec=${target}
Icon=${icon_path}
Terminal=false
Categories=Development;
EOF

  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "${app_dir}" >/dev/null 2>&1 || true
  fi

  log "Installed: ${target}"
  log "Desktop entry: ${desktop_file}"
}

install_linux() {
  local deb_path
  local rpm_path
  local appimage_path

  deb_path="$(latest_path "${BUNDLE_DIR}" f '*.deb')"
  rpm_path="$(latest_path "${BUNDLE_DIR}" f '*.rpm')"
  appimage_path="$(latest_path "${BUNDLE_DIR}" f '*.AppImage')"

  if [[ -n "${deb_path}" && -f /etc/debian_version ]]; then
    install_linux_deb "${deb_path}"
  elif [[ -n "${rpm_path}" && -f /etc/redhat-release ]]; then
    install_linux_rpm "${rpm_path}"
  elif [[ -n "${deb_path}" && "$(command -v dpkg || true)" ]]; then
    install_linux_deb "${deb_path}"
  elif [[ -n "${rpm_path}" && ( "$(command -v dnf || true)" || "$(command -v yum || true)" || "$(command -v rpm || true)" ) ]]; then
    install_linux_rpm "${rpm_path}"
  elif [[ -n "${appimage_path}" ]]; then
    install_linux_appimage "${appimage_path}"
  else
    die "No Linux .deb, .rpm, or .AppImage bundle found under ${BUNDLE_DIR}"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) SKIP_BUILD=1; shift ;;
    --no-install) SKIP_INSTALL=1; shift ;;
    --build-runtime) BUILD_RUNTIME=1; shift ;;
    --force-runtime-build) BUILD_RUNTIME=1; FORCE_RUNTIME_BUILD=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

[[ -d "${DESKTOP_DIR}" ]] || die "Desktop project not found: ${DESKTOP_DIR}"

case "$(uname -s)" in
  Darwin)
    build_macos
    clear_desktop_caches
    [[ "${SKIP_INSTALL}" -eq 1 ]] || install_macos
    ;;
  Linux)
    build_linux
    clear_desktop_caches
    [[ "${SKIP_INSTALL}" -eq 1 ]] || install_linux
    ;;
  *)
    die "Unsupported OS: $(uname -s). This script supports macOS and Linux only."
    ;;
esac

log "Done"
