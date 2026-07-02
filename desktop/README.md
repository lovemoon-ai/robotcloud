# RobotCloud Tauri

This is the Rust/Tauri implementation of RobotCloud Desktop. It loads the
RobotCloud web frontend from the network and exposes local SO101/LeRobot
capabilities through a narrow JavaScript bridge.

Default web URL:

```text
https://robotcloud.conductor-ai.top/so101/
```

For local desktop frontend testing, start the frontend and point the shell at
the local SO101 route:

```powershell
$env:ROBOTCLOUD_DESKTOP_URL="http://127.0.0.1:3000/so101/"
pnpm dev
```

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

Runtime zips are build artifacts and are intentionally ignored by Git because
they exceed normal repository size limits. The Windows packaging script can
build `lerobot-env-win.zip` with micromamba, or copy an existing archive from
`ROBOTCLOUD_WINDOWS_RUNTIME_ZIP`. For macOS/Linux, put the platform archive at
the path above, or set the matching `ROBOTCLOUD_*_RUNTIME_ZIP` environment
variable and the packaging script will copy it into
`src-tauri/resources/runtime/...` before building.

Windows runtime builder:

```powershell
.\scripts\build-lerobot-runtime-windows.ps1
```

Defaults:

```text
Python 3.12
lerobot==0.5.1
torch==2.10.0
torchvision==0.25.0
CPU PyTorch wheels from https://download.pytorch.org/whl/cpu
```

Frontend bridge:

```ts
window.robotcloudDesktop.status()
window.robotcloudDesktop.so101.run({ action: "info" })
window.robotcloudDesktop.so101.stop(runId)
window.robotcloudDesktop.terminal.start()
window.robotcloudDesktop.terminal.write(sessionId, "lerobot-info\r\n")
```
