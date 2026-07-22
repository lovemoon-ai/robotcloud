#!/usr/bin/env bash
# Stage VR-teleop artifacts from the third_party/operator submodule:
#   1. Build the robot-service binary and stage it as a Tauri external binary
#      (sidecar): desktop/src-tauri/binaries/robot-service-<target-triple>[.exe]
#      Tauri's bundle.externalBin appends the host target triple to the
#      configured name, so the staged file MUST carry that suffix.
#   2. Copy the SO-101 mesh STLs referenced by the bundled URDF into
#      resources/assets/assets/ (placo IK aborts without them).
#   3. Copy the SO-101 device descriptor YAML into resources/vr/.
# Staged outputs are gitignored; the operator submodule is the single source
# of truth.
#
# Usage:
#   bash desktop/scripts/build-robot-service.sh
#   TARGET_TRIPLE=aarch64-apple-darwin bash desktop/scripts/build-robot-service.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OPERATOR_ROBOT_DIR="$REPO_ROOT/third_party/operator/robot"
OUT_DIR="$REPO_ROOT/desktop/src-tauri/binaries"

log() { printf '\033[36m[build-robot-service]\033[0m %s\n' "$*"; }
fail() { printf '\033[31m[build-robot-service] FAIL:\033[0m %s\n' "$*" >&2; exit 1; }

[ -f "$OPERATOR_ROBOT_DIR/Cargo.toml" ] \
  || fail "operator submodule missing; run: git submodule update --init third_party/operator"
command -v cargo >/dev/null 2>&1 || fail "cargo not on PATH; install Rust"

TARGET_TRIPLE="${TARGET_TRIPLE:-$(rustc -Vv | awk '/^host:/{print $2}')}"
[ -n "$TARGET_TRIPLE" ] || fail "could not determine target triple"

EXT=""
case "$TARGET_TRIPLE" in
  *windows*) EXT=".exe" ;;
esac

log "building robot-service (release) for $TARGET_TRIPLE"
(cd "$OPERATOR_ROBOT_DIR" && cargo build --release -p robot-service)

SRC="$OPERATOR_ROBOT_DIR/target/release/robot-service$EXT"
[ -f "$SRC" ] || fail "built binary not found at $SRC"

mkdir -p "$OUT_DIR"
DEST="$OUT_DIR/robot-service-$TARGET_TRIPLE$EXT"
cp "$SRC" "$DEST"
log "staged $DEST"

# --- stage mesh STLs referenced by the bundled URDF ---------------------------
URDF="$REPO_ROOT/desktop/src-tauri/resources/assets/so101_new_calib.urdf"
MESH_SRC_DIR="$REPO_ROOT/third_party/operator/examples/mujuco-arm-so101/assets/so101/assets"
MESH_DEST_DIR="$REPO_ROOT/desktop/src-tauri/resources/assets/assets"
[ -f "$URDF" ] || fail "bundled URDF not found at $URDF"
# Meshes are deliberately not vendored in operator; its prepare.sh fetches them
# (pinned commit of google-deepmind/mujoco_menagerie, ~17MB, idempotent).
MESH_PREP="$REPO_ROOT/third_party/operator/examples/mujuco-arm-so101/prepare.sh"
if ! bash "$MESH_PREP" --check >/dev/null 2>&1; then
  log "fetching SO-101 mesh STLs via operator prepare.sh (one time, ~17MB)"
  bash "$MESH_PREP" || fail "mesh fetch failed; run $MESH_PREP by hand"
fi
[ -d "$MESH_SRC_DIR" ] || fail "mesh dir missing in operator submodule: $MESH_SRC_DIR"
mkdir -p "$MESH_DEST_DIR"
MESHES=$(grep -oE 'assets/[^"]*\.stl' "$URDF" | sed 's|^assets/||' | sort -u)
[ -n "$MESHES" ] || fail "no mesh references found in $URDF"
count=0
for mesh in $MESHES; do
  [ -f "$MESH_SRC_DIR/$mesh" ] || fail "URDF references $mesh but it is missing from $MESH_SRC_DIR"
  cp "$MESH_SRC_DIR/$mesh" "$MESH_DEST_DIR/$mesh"
  count=$((count + 1))
done
log "staged $count mesh STL(s) into resources/assets/assets/"

# --- stage the SO-101 device descriptors (single + dual) -----------------------
DESCRIPTOR_DEST_DIR="$REPO_ROOT/desktop/src-tauri/resources/vr"
mkdir -p "$DESCRIPTOR_DEST_DIR"
for descriptor in so101_real_descriptor.yaml so101_dual_real_descriptor.yaml; do
  src="$REPO_ROOT/third_party/operator/robot/configs/$descriptor"
  [ -f "$src" ] || fail "descriptor missing in operator submodule: $src"
  cp "$src" "$DESCRIPTOR_DEST_DIR/$descriptor"
  log "staged resources/vr/$descriptor"
done
