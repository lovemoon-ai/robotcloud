param(
    [string] $WorkDir = "",
    [string] $EnvPath = "",
    [string] $OutputZip = "",
    [string] $MicromambaExe = "",
    [string] $MicromambaUrl = "https://micro.mamba.pm/api/micromamba/win-64/latest",
    [string] $PythonVersion = "3.12",
    [string] $LeRobotSpec = "lerobot[dataset,viz]==0.6.0",
    [string] $TorchSpec = "torch==2.10.0",
    [string] $TorchVisionSpec = "torchvision==0.25.0",
    [string] $TorchIndexUrl = "https://download.pytorch.org/whl/cpu",
    [string[]] $ExtraPipPackages = @("feetech-servo-sdk>=1.0.0,<2.0.0", "deepdiff>=7.0.1,<9.0.0", "torchcodec>=0.10.0,<0.11.0"),
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
        [AllowEmptyCollection()]
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

function Install-LeRobotPackages {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Python
    )

    $lerobotArgs = @("-m", "pip", "install", $LeRobotSpec)
    if ($ExtraPipPackages.Count -gt 0) {
        $lerobotArgs += $ExtraPipPackages
    }
    Invoke-Checked $Python $lerobotArgs
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
        Install-LeRobotPackages -Python $python
        return
    }

    if ((Test-Path -LiteralPath $EnvPath) -and $Force) {
        Assert-ChildPath $EnvPath $WorkDir
        Remove-Item -LiteralPath $EnvPath -Recurse -Force
    }

    New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
    Install-Micromamba
    Invoke-Checked $MicromambaExe @(
        "create",
        "-y",
        "-p",
        $EnvPath,
        "-c",
        "conda-forge",
        "python=$PythonVersion",
        "pip",
        "ffmpeg"
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

    Install-LeRobotPackages -Python $python
}

function Test-FileContainsText {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path,
        [Parameter(Mandatory = $true)]
        [string[]] $Needles
    )

    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $encoding = [System.Text.Encoding]::GetEncoding(28591)
    $text = $encoding.GetString($bytes)
    foreach ($needle in $Needles) {
        if (-not [string]::IsNullOrEmpty($needle) -and $text.Contains($needle)) {
            return $true
        }
    }
    return $false
}

function Get-RelativePath {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Base,
        [Parameter(Mandatory = $true)]
        [string] $Path
    )

    $baseUri = [Uri](([System.IO.Path]::GetFullPath($Base).TrimEnd('\')) + '\')
    $pathUri = [Uri]([System.IO.Path]::GetFullPath($Path))
    [Uri]::UnescapeDataString($baseUri.MakeRelativeUri($pathUri).ToString()).Replace('/', '\')
}

function Get-ConsoleEntryPoints {
    $sitePackages = Join-Path $EnvPath "Lib\site-packages"
    if (-not (Test-Path -LiteralPath $sitePackages)) {
        return @()
    }

    $entries = [ordered]@{}
    Get-ChildItem -LiteralPath $sitePackages -Directory -Filter "*.dist-info" -ErrorAction SilentlyContinue | ForEach-Object {
        $entryFile = Join-Path $_.FullName "entry_points.txt"
        if (Test-Path -LiteralPath $entryFile) {
            $section = ""
            foreach ($rawLine in Get-Content -LiteralPath $entryFile) {
                $line = $rawLine.Trim()
                if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("#") -or $line.StartsWith(";")) {
                    continue
                }
                if ($line.StartsWith("[") -and $line.EndsWith("]")) {
                    $section = $line.Substring(1, $line.Length - 2)
                    continue
                }
                if ($section -ne "console_scripts") {
                    continue
                }

                $parts = $line -split "\s*=\s*", 2
                if ($parts.Count -ne 2) {
                    continue
                }
                $name = $parts[0].Trim()
                $target = ($parts[1] -replace "\s*\[.*\]\s*$", "").Trim()
                $targetParts = $target -split ":", 2
                if ($targetParts.Count -ne 2) {
                    continue
                }
                $module = $targetParts[0].Trim()
                $attribute = $targetParts[1].Trim()
                if ($name -notmatch "^[A-Za-z0-9_.-]+$") {
                    continue
                }
                if ($module -notmatch "^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$") {
                    continue
                }
                if ($attribute -notmatch "^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$") {
                    continue
                }

                $entries[$name] = [pscustomobject]@{
                    Name = $name
                    Module = $module
                    Attribute = $attribute
                }
            }
        }
    }

    @($entries.Values)
}

function Write-ConsoleShims {
    $entries = @(Get-ConsoleEntryPoints)
    if ($entries.Count -eq 0) {
        throw "No Python console entry points found in runtime environment."
    }

    $shimDir = Join-Path $EnvPath "robotcloud-shims"
    New-Item -ItemType Directory -Force -Path $shimDir | Out-Null

    foreach ($entry in $entries) {
        $shimPath = Join-Path $shimDir "$($entry.Name).cmd"
        $pythonSnippet = "import functools, importlib, re, sys; sys.argv[0]=re.sub(r'(-script\.pyw?|\.exe)?$', '', sys.argv[0]); module=importlib.import_module('$($entry.Module)'); sys.exit(functools.reduce(getattr, '$($entry.Attribute)'.split('.'), module)())"
        $content = @"
@echo off
setlocal
set "ROBOTCLOUD_LEROBOT_ENV=%~dp0.."
"%ROBOTCLOUD_LEROBOT_ENV%\python.exe" -c "$pythonSnippet" %*
exit /b %ERRORLEVEL%
"@
        [System.IO.File]::WriteAllText($shimPath, $content.Replace("`n", "`r`n"), [System.Text.Encoding]::ASCII)
    }

    Write-Host "Generated $($entries.Count) runtime-relative console shims: $shimDir"
}

function Remove-EmbeddedConsoleLaunchers {
    $scripts = Join-Path $EnvPath "Scripts"
    if (-not (Test-Path -LiteralPath $scripts)) {
        return
    }

    $needles = @(
        $EnvPath,
        $EnvPath.Replace('\', '/'),
        "C:\Users\"
    )

    $removed = 0
    Get-ChildItem -LiteralPath $scripts -Force -File -Filter "*.exe" -ErrorAction SilentlyContinue | ForEach-Object {
        if (Test-FileContainsText -Path $_.FullName -Needles $needles) {
            Remove-Item -LiteralPath $_.FullName -Force
            $removed += 1
        }
    }

    Get-ChildItem -LiteralPath $scripts -Force -File -ErrorAction SilentlyContinue | Where-Object {
        $_.Extension -eq "" -and (Test-FileContainsText -Path $_.FullName -Needles $needles)
    } | ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Force
        $removed += 1
    }

    Write-Host "Removed $removed console launchers with embedded build prefixes."
}

function Remove-RuntimeBuildJunk {
    Write-Host "Cleaning Python caches from runtime environment"
    Get-ChildItem -LiteralPath $EnvPath -Recurse -Force -Directory -Filter "__pycache__" -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    foreach ($filter in @("*.pyc", "*.pyo")) {
        Get-ChildItem -LiteralPath $EnvPath -Recurse -Force -File -Filter $filter -ErrorAction SilentlyContinue |
            Remove-Item -Force -ErrorAction SilentlyContinue
    }
    Get-ChildItem -LiteralPath $EnvPath -Recurse -Force -Directory -Filter ".pytest_cache" -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

    $history = Join-Path $EnvPath "conda-meta\history"
    if (Test-Path -LiteralPath $history) {
        Remove-Item -LiteralPath $history -Force
    }
    Get-ChildItem -LiteralPath $EnvPath -Recurse -Force -File -Filter "loaders.cache" -ErrorAction SilentlyContinue | ForEach-Object {
        if (Test-FileContainsText -Path $_.FullName -Needles @($EnvPath, $EnvPath.Replace('\', '/'), "C:\Users\")) {
            Remove-Item -LiteralPath $_.FullName -Force
        }
    }
}

function Test-RuntimeEnv {
    $python = Join-Path $EnvPath "python.exe"
    $lerobotInfo = Join-Path $EnvPath "robotcloud-shims\lerobot-info.cmd"
    if (-not (Test-Path -LiteralPath $python)) {
        throw "Missing runtime Python: $python"
    }
    if (-not (Test-Path -LiteralPath $lerobotInfo)) {
        throw "Missing lerobot-info runtime shim: $lerobotInfo"
    }

    if (-not $SkipSmokeTest) {
        Invoke-Checked $python @("-c", "import datasets, deepdiff, lerobot, rerun, torch, torchvision, serial, scservo_sdk; print('runtime imports ok')")
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

function Assert-NoRuntimeAbsolutePaths {
    function Should-ScanRuntimeFile {
        param(
            [Parameter(Mandatory = $true)]
            [string] $FullName
        )

        $relative = Get-RelativePath -Base $EnvPath -Path $FullName
        if ($relative -like "Scripts\*" -or
            $relative -like "robotcloud-shims\*" -or
            $relative -like "conda-meta\*" -or
            $relative -match "\\[^\\]+\.dist-info\\") {
            return $true
        }

        return $relative -match "\.(bat|cmd|ps1|sh|py|pth|txt|json|cfg|ini|yaml|yml|toml|xml|cache|pc|cmake)$"
    }

    function Is-StrictPrefixFile {
        param(
            [Parameter(Mandatory = $true)]
            [string] $Relative
        )

        $Relative -like "Scripts\*" -or
            $Relative -like "robotcloud-shims\*" -or
            $Relative -like "conda-meta\*"
    }

    $generalForbiddenRegexes = @(
        [regex]::Escape($EnvPath),
        [regex]::Escape($EnvPath.Replace('\', '/')),
        [regex]::Escape($WorkDir),
        [regex]::Escape($WorkDir.Replace('\', '/')),
        "Documents\\Codex",
        "\.runtime-build"
    )
    $strictForbiddenRegexes = @("(?i)[A-Z]:\\Users\\") + $generalForbiddenRegexes
    $encoding = [System.Text.Encoding]::GetEncoding(28591)
    $hits = New-Object System.Collections.Generic.List[string]

    foreach ($file in Get-ChildItem -LiteralPath $EnvPath -Recurse -Force -File -ErrorAction SilentlyContinue) {
        if ($file.Length -gt 16MB) {
            continue
        }
        if (-not (Should-ScanRuntimeFile -FullName $file.FullName)) {
            continue
        }

        $relative = Get-RelativePath -Base $EnvPath -Path $file.FullName
        $forbiddenRegexes = if (Is-StrictPrefixFile -Relative $relative) {
            $strictForbiddenRegexes
        } else {
            $generalForbiddenRegexes
        }
        $text = $encoding.GetString([System.IO.File]::ReadAllBytes($file.FullName))
        foreach ($pattern in $forbiddenRegexes) {
            if ($text -match $pattern) {
                $hits.Add($relative)
                break
            }
        }
        if ($hits.Count -ge 50) {
            break
        }
    }

    if ($hits.Count -gt 0) {
        throw "Runtime still contains build-machine absolute paths:`n$($hits -join "`n")"
    }
}

function New-ZipFromDirectoryContents {
    param(
        [Parameter(Mandatory = $true)]
        [string] $SourceDir,
        [Parameter(Mandatory = $true)]
        [string] $ZipPath
    )

    Add-Type -AssemblyName System.IO.Compression
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
New-RuntimeEnv
Write-ConsoleShims
Remove-EmbeddedConsoleLaunchers
Test-RuntimeEnv
Write-RuntimeManifest
Remove-RuntimeBuildJunk
Assert-NoRuntimeAbsolutePaths
New-ZipFromDirectoryContents -SourceDir $EnvPath -ZipPath $OutputZip

Write-Host "Windows LeRobot runtime archive ready: $OutputZip"
