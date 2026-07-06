Place platform LeRobot runtime archives here before packaging:

- `win/lerobot-env-win.zip`
- `macos/lerobot-env-macos.zip`
- `linux/lerobot-env-linux.zip`

The archives are release/build artifacts and are ignored by Git. The packaging
scripts can copy them from explicit artifact paths:

- `ROBOTCLOUD_WINDOWS_RUNTIME_ZIP`
- `ROBOTCLOUD_MACOS_RUNTIME_ZIP`
- `ROBOTCLOUD_LINUX_RUNTIME_ZIP`

Windows can also be built directly:

```powershell
desktop/scripts/build-lerobot-runtime-windows.ps1
```

macOS can also be built directly:

```bash
desktop/scripts/build-lerobot-runtime-mac.sh
```

The desktop app extracts the archive into its app data directory on first use.
Windows archives should include `robotcloud-shims/*.cmd` runtime-relative
console entries. The desktop app regenerates them after extraction so
`lerobot-*` commands do not depend on build-machine absolute paths.
