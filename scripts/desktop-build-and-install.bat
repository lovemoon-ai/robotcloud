@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "PROJECT_ROOT=%%~fI"
set "DESKTOP_DIR=%PROJECT_ROOT%\desktop"
set "BUNDLE_DIR=%DESKTOP_DIR%\src-tauri\target\release\bundle"
set "MSI_DIR=%BUNDLE_DIR%\msi"

set "SKIP_BUILD=0"
set "SKIP_INSTALL=0"
set "BUILD_RUNTIME=0"
set "FORCE_RUNTIME_BUILD=0"
set "NO_PAUSE=0"
set "SHOW_HELP=0"

:parse_args
if "%~1"=="" goto after_parse
if /I "%~1"=="--skip-build" (
  set "SKIP_BUILD=1"
  shift
  goto parse_args
)
if /I "%~1"=="--no-install" (
  set "SKIP_INSTALL=1"
  shift
  goto parse_args
)
if /I "%~1"=="--build-runtime" (
  set "BUILD_RUNTIME=1"
  shift
  goto parse_args
)
if /I "%~1"=="--force-runtime-build" (
  set "BUILD_RUNTIME=1"
  set "FORCE_RUNTIME_BUILD=1"
  shift
  goto parse_args
)
if /I "%~1"=="--no-pause" (
  set "NO_PAUSE=1"
  shift
  goto parse_args
)
if /I "%~1"=="-h" (
  set "SHOW_HELP=1"
  shift
  goto parse_args
)
if /I "%~1"=="--help" (
  set "SHOW_HELP=1"
  shift
  goto parse_args
)
call :die "Unknown argument: %~1"
goto failure

:after_parse
if "%SHOW_HELP%"=="1" (
  call :usage
  goto success
)

call :prepend_path_if_exists "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin"
call :prepend_path_if_exists "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
call :prepend_path_if_exists "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd"
call :prepend_path_if_exists "%USERPROFILE%\.cargo\bin"

if not exist "%DESKTOP_DIR%\package.json" (
  call :die "Desktop project not found: %DESKTOP_DIR%"
  goto failure
)

call :require powershell.exe || goto failure
call :require pnpm.cmd || goto failure
call :require cargo.exe || goto failure

if "%SKIP_BUILD%"=="1" (
  call :log "Skipping Windows build"
) else (
  call :build_windows || goto failure
)

call :find_latest_msi
if not defined MSI_PATH (
  call :die "No Windows .msi bundle found under %MSI_DIR%"
  goto failure
)
call :log "Latest MSI: %MSI_PATH%"

if "%SKIP_INSTALL%"=="1" (
  call :log "Skipping install"
) else (
  call :install_msi "%MSI_PATH%" || goto failure
)

goto success

:usage
echo Usage: scripts\desktop-build-and-install.bat [options]
echo.
echo Build RobotCloud Desktop for Windows and install the newest MSI.
echo.
echo Options:
echo   --skip-build             Install the newest existing MSI without rebuilding.
echo   --no-install             Build only; do not install.
echo   --build-runtime          Build the Windows LeRobot runtime if needed.
echo   --force-runtime-build    Rebuild the Windows LeRobot runtime before packaging.
echo   --no-pause               Do not pause before exiting.
echo   -h, --help               Show this help.
echo.
echo Environment:
echo   ROBOTCLOUD_WINDOWS_RUNTIME_ZIP=C:\path\to\lerobot-env-win.zip
echo   ROBOTCLOUD_INSTALL_DIR=C:\path\to\RobotCloud
echo   ROBOTCLOUD_MSI_ARGS=/qn ALLUSERS=2 MSIINSTALLPERUSER=1 INSTALLDIR="C:\path\to\RobotCloud\"
exit /b 0

:log
echo [desktop-install] %~1
exit /b 0

:die
echo [desktop-install] ERROR: %~1 1>&2
exit /b 1

:require
where "%~1" >nul 2>nul
if errorlevel 1 (
  call :die "Missing required command: %~1"
  exit /b 1
)
exit /b 0

:prepend_path_if_exists
if exist "%~1" set "PATH=%~1;%PATH%"
exit /b 0

:build_windows
set "BUILD_SCRIPT=%DESKTOP_DIR%\scripts\build-windows.ps1"
if not exist "%BUILD_SCRIPT%" (
  call :die "Missing Windows build script: %BUILD_SCRIPT%"
  exit /b 1
)

set "BUILD_ARGS="
if "%BUILD_RUNTIME%"=="1" set "BUILD_ARGS=!BUILD_ARGS! -BuildRuntime"
if "%FORCE_RUNTIME_BUILD%"=="1" set "BUILD_ARGS=!BUILD_ARGS! -ForceRuntimeBuild"

call :log "Building Windows desktop package"
pushd "%DESKTOP_DIR%" >nul
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%BUILD_SCRIPT%" !BUILD_ARGS!
set "BUILD_EXIT=%ERRORLEVEL%"
popd >nul
if not "%BUILD_EXIT%"=="0" (
  call :die "Windows desktop build failed with exit code %BUILD_EXIT%"
  exit /b 1
)
exit /b 0

:find_latest_msi
set "MSI_PATH="
if not exist "%MSI_DIR%" exit /b 0
for /f "delims=" %%F in ('dir /b /a:-d /o:-d "%MSI_DIR%\*.msi" 2^>nul') do (
  if not defined MSI_PATH set "MSI_PATH=%MSI_DIR%\%%F"
)
exit /b 0

:install_msi
set "MSI_TO_INSTALL=%~1"
if not exist "%MSI_TO_INSTALL%" (
  call :die "MSI not found: %MSI_TO_INSTALL%"
  exit /b 1
)

call :log "Stopping running RobotCloud desktop processes"
taskkill.exe /IM robotcloud.exe /F >nul 2>nul

if defined ROBOTCLOUD_MSI_ARGS (
  call :log "Installing MSI"
  start "" /wait msiexec.exe /i "%MSI_TO_INSTALL%" %ROBOTCLOUD_MSI_ARGS%
  set "INSTALL_EXIT=!ERRORLEVEL!"
) else (
  call :prepare_user_install || exit /b 1
  call :log "Installing MSI to !ROBOTCLOUD_INSTALL_DIR!"
  start "" /wait msiexec.exe /i "%MSI_TO_INSTALL%" /qn ALLUSERS=2 MSIINSTALLPERUSER=1 INSTALLDIR="!ROBOTCLOUD_INSTALL_DIR!\" REINSTALLMODE=amus /l*v "%TEMP%\robotcloud-msi-install.log"
  set "INSTALL_EXIT=!ERRORLEVEL!"
  if "!INSTALL_EXIT!"=="0" (
    if not exist "!ROBOTCLOUD_INSTALL_DIR!\robotcloud.exe" (
      call :die "MSI reported success, but robotcloud.exe was not found in !ROBOTCLOUD_INSTALL_DIR!"
      exit /b 1
    )
  )
)
if "%INSTALL_EXIT%"=="0" (
  call :log "Installed: %MSI_TO_INSTALL%"
  exit /b 0
)
if "%INSTALL_EXIT%"=="3010" (
  call :log "Installed: %MSI_TO_INSTALL% (reboot required)"
  exit /b 0
)
call :die "MSI install failed with exit code %INSTALL_EXIT%"
exit /b 1

:prepare_user_install
if not defined ROBOTCLOUD_INSTALL_DIR set "ROBOTCLOUD_INSTALL_DIR=%LOCALAPPDATA%\Programs\RobotCloud"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $target = [System.IO.Path]::GetFullPath($env:ROBOTCLOUD_INSTALL_DIR).TrimEnd('\') + '\'; $key = 'HKCU:\Software\conductor-ai\RobotCloud'; if (Test-Path $key) { Remove-ItemProperty -Path $key -Name InstallDir -ErrorAction SilentlyContinue; Remove-ItemProperty -Path $key -Name '(default)' -ErrorAction SilentlyContinue }; $roots = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'); foreach ($root in $roots) { if (-not (Test-Path $root)) { continue }; foreach ($child in Get-ChildItem $root) { $item = Get-ItemProperty $child.PSPath -ErrorAction SilentlyContinue; if ($item.DisplayName -ne 'RobotCloud' -or [string]::IsNullOrWhiteSpace($item.InstallLocation)) { continue }; $location = [System.IO.Path]::GetFullPath([string]$item.InstallLocation).TrimEnd('\') + '\'; if ($location -ne $target) { continue }; $process = Start-Process -FilePath msiexec.exe -ArgumentList @('/x', $child.PSChildName, '/qn') -Wait -PassThru; if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 1605) { exit $process.ExitCode } } }"
if errorlevel 1 (
  call :die "Failed to prepare user install directory: %ROBOTCLOUD_INSTALL_DIR%"
  exit /b 1
)
exit /b 0

:success
call :log "Done"
if not "%NO_PAUSE%"=="1" pause
exit /b 0

:failure
if not "%NO_PAUSE%"=="1" pause
exit /b 1
