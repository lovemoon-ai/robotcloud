@echo off
setlocal EnableExtensions EnableDelayedExpansion

for %%I in ("%~dp0.") do set "ROOT_DIR=%%~fI"

if not defined LEROBOT_DIR set "LEROBOT_DIR=%ROOT_DIR%\lerobot"
set "PY_VERSION=3.10"
if not defined VENV_DIR set "VENV_DIR=%LEROBOT_DIR%\.venv"
if not defined INSTALL_SYSTEM_DEPS set "INSTALL_SYSTEM_DEPS=0"
if not defined INSTALL_GAMEPAD_EXTRA set "INSTALL_GAMEPAD_EXTRA=1"

call :require_cmd git || goto :fail
call :install_uv_if_missing || goto :fail
call :install_system_deps || goto :fail
call :clone_lerobot || goto :fail
call :create_venv || goto :fail
call :install_torch || goto :fail
call :install_lerobot || goto :fail
call :verify_commands || goto :fail

call :log Done. Activate with: "%VENV_DIR%\Scripts\activate"
call :prompt_exit
exit /b 0

:log
set "MSG=%*"
echo [lerobot-install] %MSG%
exit /b 0

:require_cmd
where %1 >nul 2>&1
if errorlevel 1 (
  call :log Missing required command: %1
  exit /b 1
)
exit /b 0

:install_uv_if_missing
where uv >nul 2>&1
if not errorlevel 1 exit /b 0

call :log uv not found; attempting to install
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

where uv >nul 2>&1
if not errorlevel 1 exit /b 0

if exist "%USERPROFILE%\.local\bin\uv.exe" (
  set "PATH=%USERPROFILE%\.local\bin;%PATH%"
)

where uv >nul 2>&1
if not errorlevel 1 exit /b 0

call :log uv install failed or not on PATH.
exit /b 1

:install_system_deps
if not "%INSTALL_SYSTEM_DEPS%"=="1" exit /b 0

where winget >nul 2>&1
if errorlevel 1 (
  call :log winget not found; skipping ffmpeg install.
  exit /b 0
)

call :log Installing ffmpeg via winget
winget install --id Gyan.FFmpeg -e --source winget --accept-package-agreements --accept-source-agreements
exit /b 0

:clone_lerobot
if exist "%LEROBOT_DIR%\.git" (
  call :log LeRobot repo already exists at "%LEROBOT_DIR%"
  exit /b 0
)

if not exist "%LEROBOT_DIR%" (
  for %%I in ("%LEROBOT_DIR%\..") do mkdir "%%~fI" >nul 2>&1
)

git clone https://github.com/huggingface/lerobot.git "%LEROBOT_DIR%"
exit /b 0

:create_venv
if exist "%VENV_DIR%\Scripts\python.exe" (
  call :log Using existing venv at "%VENV_DIR%"
  exit /b 0
)

uv venv --python "%PY_VERSION%" "%VENV_DIR%"
exit /b 0

:install_torch
set "PY=%VENV_DIR%\Scripts\python.exe"

if defined FORCE_TORCH_INDEX_URL (
  uv pip install --python "%PY%" torch torchvision --index-url "%FORCE_TORCH_INDEX_URL%"
) else (
  uv pip install --python "%PY%" torch torchvision
)
exit /b 0

:install_lerobot
set "PY=%VENV_DIR%\Scripts\python.exe"
set "EXTRAS=feetech,async"

if "%INSTALL_GAMEPAD_EXTRA%"=="1" set "EXTRAS=feetech,async,gamepad"

pushd "%LEROBOT_DIR%" >nul
uv pip install --python "%PY%" -e ".[!EXTRAS!]"
popd >nul
exit /b 0

:verify_commands
set "BIN=%VENV_DIR%\Scripts"
set "CMDS=lerobot-setup-motors lerobot-calibrate lerobot-teleoperate lerobot-record lerobot-replay"

for %%C in (%CMDS%) do (
  if not exist "%BIN%\%%C.exe" (
    call :log Expected command not found: "%BIN%\%%C.exe"
    exit /b 1
  )
  "%BIN%\%%C.exe" --help >nul
)

exit /b 0

:fail
call :prompt_exit
exit /b 1

:prompt_exit
set "PROMPT_MSG=Press Enter to exit..."
set /p "PROMPT_MSG=%PROMPT_MSG%"
exit /b 0
