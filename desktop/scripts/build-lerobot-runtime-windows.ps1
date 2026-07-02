param(
    [string] $WorkDir = "",
    [string] $EnvPath = "",
    [string] $OutputZip = "",
    [string] $MicromambaExe = "",
    [string] $MicromambaUrl = "https://micro.mamba.pm/api/micromamba/win-64/latest",
    [string] $PythonVersion = "3.12",
    [string] $LeRobotSpec = "lerobot==0.5.1",
    [string] $TorchSpec = "torch==2.10.0",
    [string] $TorchVisionSpec = "torchvision==0.25.0",
    [string] $TorchIndexUrl = "https://download.pytorch.org/whl/cpu",
    [string[]] $ExtraPipPackages = @("feetech-servo-sdk>=1.0.0,<2.0.0"),
    [switch] $Force,
    [switch] $SkipSmokeTest
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($WorkDir)) {
    $WorkDir = Join-Path $Root ".runtime-build\win"
}
if ([string]::IsNullOrWhiteSpace($EnvPath)) {
    $EnvPath = Join-Path $WorkDir "lerobot-env"
}
if ([string]::IsNullOrWhiteSpace($OutputZip)) {
    $OutputZip = Join-Path $Root "src-tauri\resources\runtime\win\lerobot-env-win.zip"
}
if ([string]::IsNullOrWhiteSpace($MicromambaExe)) {
    $MicromambaExe = $env:MICROMAMBA_EXE
}
if ([string]::IsNullOrWhiteSpace($MicromambaExe)) {
    $MicromambaExe = Join-Path $WorkDir "micromamba.exe"
}

$WorkDir = [System.IO.Path]::GetFullPath($WorkDir)
$EnvPath = [System.IO.Path]::GetFullPath($EnvPath)
$OutputZip = [System.IO.Path]::GetFullPath($OutputZip)
$MicromambaExe = [System.IO.Path]::GetFullPath($MicromambaExe)

$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:PIP_DISABLE_PIP_VERSION_CHECK = "1"
$env:PIP_NO_INPUT = "1"

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string] $FilePath,
        [Parameter(Mandatory = $true)]
        [string[]] $Arguments
    )

    Write-Host "> $FilePath $($Arguments -join ' ')"
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE`: $FilePath $($Arguments -join ' ')"
    }
}

function Assert-ChildPath {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Child,
        [Parameter(Mandatory = $true)]
        [string] $Parent
    )

    $childFull = [System.IO.Path]::GetFullPath($Child).TrimEnd('\')
    $parentFull = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\')
    if (-not $childFull.StartsWith($parentFull + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify path outside build workspace: $childFull"
    }
}

function Install-Micromamba {
    if (Test-Path -LiteralPath $MicromambaExe) {
        return
    }

    Assert-ChildPath $MicromambaExe $WorkDir
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $MicromambaExe) | Out-Null

    $archive = Join-Path $WorkDir "micromamba.tar.bz2"
    $extractDir = Join-Path $WorkDir "micromamba-download"
    if (Test-Path -LiteralPath $extractDir) {
        Remove-Item -LiteralPath $extractDir -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null

    Write-Host "Downloading micromamba from $MicromambaUrl"
    Invoke-WebRequest -Uri $MicromambaUrl -OutFile $archive
    Invoke-Checked "tar.exe" @("-xjf", $archive, "-C", $extractDir)

    $downloaded = Get-ChildItem -LiteralPath $extractDir -Recurse -Filter "micromamba.exe" |
        Select-Object -First 1
    if (-not $downloaded) {
        throw "Downloaded micromamba archive did not contain micromamba.exe"
    }

    Copy-Item -LiteralPath $downloaded.FullName -Destination $MicromambaExe -Force
}

function New-RuntimeEnv {
    $python = Join-Path $EnvPath "python.exe"
    if ((Test-Path -LiteralPath $python) -and -not $Force) {
        Write-Host "Reusing existing runtime environment: $EnvPath"
        return
    }

    if ((Test-Path -LiteralPath $EnvPath) -and $Force) {
        Assert-ChildPath $EnvPath $WorkDir
        Remove-Item -LiteralPath $EnvPath -Recurse -Force
    }

    New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
    Invoke-Checked $MicromambaExe @(
        "create",
        "-y",
        "-p",
        $EnvPath,
        "-c",
        "conda-forge",
        "python=$PythonVersion",
        "pip"
    )

    $python = Join-Path $EnvPath "python.exe"
    if (-not (Test-Path -LiteralPath $python)) {
        throw "Python was not created at $python"
    }

    Invoke-Checked $python @("-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel")
    Invoke-Checked $python @(
        "-m",
        "pip",
        "install",
        "--index-url",
        $TorchIndexUrl,
        $TorchSpec,
        $TorchVisionSpec
    )

    $lerobotArgs = @("-m", "pip", "install", $LeRobotSpec)
    if ($ExtraPipPackages.Count -gt 0) {
        $lerobotArgs += $ExtraPipPackages
    }
    Invoke-Checked $python $lerobotArgs
}

function Remove-RuntimeBuildJunk {
    Write-Host "Cleaning Python caches from runtime environment"
    Get-ChildItem -LiteralPath $EnvPath -Recurse -Force -Directory -Filter "__pycache__" -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $EnvPath -Recurse -Force -File -Include "*.pyc", "*.pyo" -ErrorAction SilentlyContinue |
        Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $EnvPath -Recurse -Force -Directory -Filter ".pytest_cache" -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

function Test-RuntimeEnv {
    $python = Join-Path $EnvPath "python.exe"
    $lerobotInfo = Join-Path $EnvPath "Scripts\lerobot-info.exe"
    if (-not (Test-Path -LiteralPath $python)) {
        throw "Missing runtime Python: $python"
    }
    if (-not (Test-Path -LiteralPath $lerobotInfo)) {
        throw "Missing lerobot-info entrypoint: $lerobotInfo"
    }

    if (-not $SkipSmokeTest) {
        Invoke-Checked $python @("-c", "import lerobot, torch, torchvision, serial, scservo_sdk; print('runtime imports ok')")
        Invoke-Checked $lerobotInfo @()
    }
}

function Write-RuntimeManifest {
    $python = Join-Path $EnvPath "python.exe"
    $freeze = & $python -m pip freeze
    if ($LASTEXITCODE -ne 0) {
        throw "pip freeze failed"
    }

    $manifest = [ordered]@{
        createdAt = (Get-Date).ToUniversalTime().ToString("o")
        platform = "win"
        pythonVersion = $PythonVersion
        lerobotSpec = $LeRobotSpec
        torchSpec = $TorchSpec
        torchVisionSpec = $TorchVisionSpec
        torchIndexUrl = $TorchIndexUrl
        packages = $freeze
    }

    $manifestPath = Join-Path $EnvPath "ROBOTCLOUD_RUNTIME_MANIFEST.json"
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
}

function New-ZipFromDirectoryContents {
    param(
        [Parameter(Mandatory = $true)]
        [string] $SourceDir,
        [Parameter(Mandatory = $true)]
        [string] $ZipPath
    )

    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $zipParent = Split-Path -Parent $ZipPath
    New-Item -ItemType Directory -Force -Path $zipParent | Out-Null

    $tempZip = "$ZipPath.partial"
    if (Test-Path -LiteralPath $tempZip) {
        Remove-Item -LiteralPath $tempZip -Force
    }
    if (Test-Path -LiteralPath $ZipPath) {
        if (-not $Force) {
            throw "Output already exists: $ZipPath. Use -Force to overwrite it."
        }
        Remove-Item -LiteralPath $ZipPath -Force
    }

    Write-Host "Creating runtime archive: $ZipPath"
    $zip = [System.IO.Compression.ZipFile]::Open($tempZip, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $sourceFull = [System.IO.Path]::GetFullPath($SourceDir)
        $sourceUri = [Uri]($sourceFull.TrimEnd('\') + '\')
        Get-ChildItem -LiteralPath $sourceFull -Recurse -Force -File | ForEach-Object {
            $fileUri = [Uri]$_.FullName
            $relative = [Uri]::UnescapeDataString($sourceUri.MakeRelativeUri($fileUri).ToString())
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $zip,
                $_.FullName,
                $relative,
                [System.IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
        }
    } finally {
        $zip.Dispose()
    }

    Move-Item -LiteralPath $tempZip -Destination $ZipPath -Force
}

$isWindowsPlatform = [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT
if (-not $isWindowsPlatform) {
    throw "This script must run on Windows because it builds the native Windows LeRobot runtime."
}

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
Install-Micromamba
New-RuntimeEnv
Test-RuntimeEnv
Write-RuntimeManifest
Remove-RuntimeBuildJunk
New-ZipFromDirectoryContents -SourceDir $EnvPath -ZipPath $OutputZip

Write-Host "Windows LeRobot runtime archive ready: $OutputZip"
