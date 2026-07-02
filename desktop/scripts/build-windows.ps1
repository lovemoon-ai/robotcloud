$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$RuntimeZip = Join-Path $Root "src-tauri\resources\runtime\win\lerobot-env-win.zip"
if (-not (Test-Path $RuntimeZip)) {
    $SourceRuntimeZip = $env:ROBOTCLOUD_WINDOWS_RUNTIME_ZIP
    if (-not [string]::IsNullOrWhiteSpace($SourceRuntimeZip) -and (Test-Path $SourceRuntimeZip)) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $RuntimeZip) | Out-Null
        Copy-Item -LiteralPath $SourceRuntimeZip -Destination $RuntimeZip -Force
    } else {
        throw "Missing Windows runtime archive: $RuntimeZip. Set ROBOTCLOUD_WINDOWS_RUNTIME_ZIP to a local lerobot-env-win.zip release artifact before building."
    }
}

pnpm install
pnpm tauri build --bundles msi
