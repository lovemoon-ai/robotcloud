param(
    [switch] $BuildRuntime,
    [switch] $ForceRuntimeBuild
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$RuntimeZip = Join-Path $Root "src-tauri\resources\runtime\win\lerobot-env-win.zip"
if ($BuildRuntime -and (Test-Path $RuntimeZip) -and $ForceRuntimeBuild) {
    Remove-Item -LiteralPath $RuntimeZip -Force
}

if (-not (Test-Path $RuntimeZip)) {
    $SourceRuntimeZip = $env:ROBOTCLOUD_WINDOWS_RUNTIME_ZIP
    if (-not [string]::IsNullOrWhiteSpace($SourceRuntimeZip) -and (Test-Path $SourceRuntimeZip)) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $RuntimeZip) | Out-Null
        Copy-Item -LiteralPath $SourceRuntimeZip -Destination $RuntimeZip -Force
    } else {
        $RuntimeBuilder = Join-Path $PSScriptRoot "build-lerobot-runtime-windows.ps1"
        if (-not (Test-Path -LiteralPath $RuntimeBuilder)) {
            throw "Missing Windows runtime archive: $RuntimeZip and runtime builder script was not found: $RuntimeBuilder"
        }
        & $RuntimeBuilder -OutputZip $RuntimeZip -Force:$ForceRuntimeBuild
    }
}

pnpm install
pnpm tauri build --bundles msi
