Place platform LeRobot runtime archives here before packaging:

- `win/lerobot-env-win.zip`
- `macos/lerobot-env-macos.zip`
- `linux/lerobot-env-linux.zip`

The archives are release/build artifacts and are ignored by Git. The packaging
scripts can copy them from explicit artifact paths:

- `ROBOTCLOUD_WINDOWS_RUNTIME_ZIP`
- `ROBOTCLOUD_MACOS_RUNTIME_ZIP`
- `ROBOTCLOUD_LINUX_RUNTIME_ZIP`

The desktop app extracts the archive into its app data directory on first use.
