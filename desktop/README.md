# RobotCloud Tauri

This is the Rust/Tauri implementation of RobotCloud Desktop. Release builds
start from the bundled SO101 workbench frontend and include the full exported
RobotCloud frontend so in-app navigation can stay inside one WebView document.
Local SO101/LeRobot capabilities are exposed through a narrow JavaScript bridge.

Default web URLs:

```text
debug:   http://127.0.0.1:6151/so101/
release: app://local/so101/ (bundled at src-tauri/frontend-dist/so101/index.html)
```

For local desktop frontend testing, start the frontend dev server, then run the
desktop shell:

```bash
cd ../frontend
npm run dev
```

```bash
pnpm dev
```

To point the debug shell at a different local frontend port, override the URL:

```powershell
$env:ROBOTCLOUD_DESKTOP_URL="http://127.0.0.1:6151/so101/"
pnpm dev
```

Release builds run `scripts/prepare-frontend-dist.mjs` before packaging. The
script exports the Next.js frontend and copies the full static export into
`src-tauri/frontend-dist/`. Use it directly when checking bundle contents:

```bash
pnpm prepare:frontend
```

Pages such as datasets, training, models, inference, settings, and plans still
use the configured cloud API, but packaged navigation between them and SO101
uses the bundled static frontend. Navigation from the cloud SO101 route is still
intercepted by Tauri and redirected back to the bundled local SO101 workbench.

Windows build:

```powershell
# Build the Windows LeRobot runtime automatically if the zip is missing.
.\scripts\build-windows.ps1
```

To force a fresh runtime rebuild:

```powershell
.\scripts\build-windows.ps1 -BuildRuntime -ForceRuntimeBuild
```

To use a prebuilt runtime artifact instead:

```powershell
$env:ROBOTCLOUD_WINDOWS_RUNTIME_ZIP="D:\artifacts\lerobot-env-win.zip"
.\scripts\build-windows.ps1
```

macOS build:

```bash
# Build the macOS LeRobot runtime automatically if the zip is missing.
./scripts/package-macos.sh
```

macOS local-frontend debug build:

```bash
# Build RobotCloud-debug.app in a DMG whose default frontend URL is http://127.0.0.1:6151/so101/.
npm run build:mac:debug
```

Run the local frontend before opening the debug app:

```bash
cd ../frontend
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000/api/v1 npm run dev
```

To force a fresh macOS runtime rebuild:

```bash
./scripts/package-macos.sh --build-runtime --force-runtime-build
```

To use a prebuilt macOS runtime artifact instead:

```bash
export ROBOTCLOUD_MACOS_RUNTIME_ZIP=/path/to/lerobot-env-macos.zip
./scripts/package-macos.sh
```

Linux build:

```bash
export ROBOTCLOUD_LINUX_RUNTIME_ZIP=/path/to/lerobot-env-linux.zip
./scripts/package-linux.sh
```

Runtime archives:

```text
src-tauri/resources/runtime/win/lerobot-env-win.zip
src-tauri/resources/runtime/macos/lerobot-env-macos.zip
src-tauri/resources/runtime/linux/lerobot-env-linux.zip
```

The Windows MSI includes the native Windows LeRobot runtime zip and the
WebView2 offline installer. The app extracts the runtime into its app data
directory on first SO101 or terminal use, so installation itself does not need
network access.

The Windows runtime must remain relocatable. The builder strips console
launchers with embedded build-machine paths and generates runtime-relative
`robotcloud-shims/*.cmd` entries; the desktop app also regenerates those shims
after extraction before exposing `lerobot-*` commands in the embedded terminal.

Runtime lookup order:

```text
1. ROBOTCLOUD_LEROBOT_ENV, when set
2. Previously extracted app data runtime
3. Bundled runtime resources in the installed app
4. Bundled runtime zip, extracted into app data on first status/command use
```

The SO101 workbench does not assume fixed serial ports or camera indexes.
Use **Detect ports** to call LeRobot's find-port helpers and fill the follower /
leader candidates, then use **Detect cameras** to call LeRobot camera discovery
and fill the OpenCV camera id plus default profile. Use each camera card's
**Check** button to verify the selected camera and refresh the actual width,
height, and fps before teleoperation or recording.

RobotCloud auto recording does not depend on a preconfigured reset pose. Each
episode ends when the current 6-joint pose remains stationary for 3 seconds;
the standalone **Save pose** action records a specific 6-joint pose to
`saved_poses/<robot-id>.json` for later inspection or manual workflows.

When **Upload** is clicked, the workbench writes a `robotcloud-prepare-upload`
command into the embedded terminal instead of invoking packaging work from the
webview. The desktop shell intercepts that terminal command, validates the local
LeRobot dataset, creates the zip on a background thread, writes the prepared
upload state, and emits a success or failure event back to the page.

Runtime zips are build artifacts and are intentionally ignored by Git because
they exceed normal repository size limits. The Windows packaging script can
build `lerobot-env-win.zip` with micromamba, or copy an existing archive from
`ROBOTCLOUD_WINDOWS_RUNTIME_ZIP`. The macOS packaging script can build
`lerobot-env-macos.zip` with micromamba, or copy an existing archive from
`ROBOTCLOUD_MACOS_RUNTIME_ZIP`. For Linux, put the platform archive at the path
above, or set `ROBOTCLOUD_LINUX_RUNTIME_ZIP` and the packaging script will copy
it into `src-tauri/resources/runtime/...` before building.

Windows runtime builder:

```powershell
.\scripts\build-lerobot-runtime-windows.ps1
```

macOS runtime builder:

```bash
./scripts/build-lerobot-runtime-mac.sh
```

Defaults:

```text
Python 3.12
lerobot[async,dataset,viz]==0.6.0
feetech-servo-sdk>=1.0.0,<2.0.0
deepdiff>=7.0.1,<9.0.0
torchcodec>=0.10.0,<0.11.0
torch==2.10.0
torchvision==0.25.0
ffmpeg from conda-forge
CPU PyTorch wheels from https://download.pytorch.org/whl/cpu
```

The macOS runtime builder uses the same package versions by default, but installs
PyTorch from PyPI unless `--torch-index-url` is provided.

Frontend bridge:

```ts
window.robotcloudDesktop.status()
window.robotcloudDesktop.so101.run({ action: "info" })
window.robotcloudDesktop.so101.stop(runId)
window.robotcloudDesktop.dataset.inspectUpload({ datasetRoot, datasetRepoId })
window.robotcloudDesktop.dataset.onPreparedUpload((prepared) => {})
window.robotcloudDesktop.dataset.onPrepareUploadError((event) => {})
window.robotcloudDesktop.terminal.start()
window.robotcloudDesktop.terminal.write(sessionId, "lerobot-info\r\n")
```
