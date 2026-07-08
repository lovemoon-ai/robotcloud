param(
    [switch] $BuildRuntime,
    [switch] $ForceRuntimeBuild
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Test-ArchiveEntryForForbiddenText {
    param(
        [Parameter(Mandatory = $true)]
        [System.IO.Compression.ZipArchiveEntry] $Entry,
        [Parameter(Mandatory = $true)]
        [string[]] $ForbiddenRegexes
    )

    if ($Entry.Length -gt 16MB) {
        return $false
    }
    if (-not (Test-ArchiveEntryShouldScan -Name $Entry.FullName)) {
        return $false
    }

    $encoding = [System.Text.Encoding]::GetEncoding(28591)
    $forbiddenRegexesForEntry = if (Test-ArchiveEntryStrictPrefix -Name $Entry.FullName) {
        @("(?i)[A-Z]:\\Users\\") + $ForbiddenRegexes
    } else {
        $ForbiddenRegexes
    }
    $stream = $Entry.Open()
    try {
        $buffer = New-Object byte[] ([int]$Entry.Length)
        $offset = 0
        while ($offset -lt $buffer.Length) {
            $read = $stream.Read($buffer, $offset, $buffer.Length - $offset)
            if ($read -le 0) {
                break
            }
            $offset += $read
        }
        $text = $encoding.GetString($buffer, 0, $offset)
        foreach ($pattern in $forbiddenRegexesForEntry) {
            if ($text -match $pattern) {
                return $true
            }
        }
        return $false
    } finally {
        $stream.Dispose()
    }
}

function Test-ArchiveEntryShouldScan {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Name
    )

    $normalized = $Name.Replace('/', '\')
    if ($normalized -like "Scripts\*" -or
        $normalized -like "robotcloud-shims\*" -or
        $normalized -like "conda-meta\*" -or
        $normalized -match "\\[^\\]+\.dist-info\\") {
        return $true
    }

    return $normalized -match "\.(bat|cmd|ps1|sh|py|pth|txt|json|cfg|ini|yaml|yml|toml|xml|cache|pc|cmake)$"
}

function Test-ArchiveEntryStrictPrefix {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Name
    )

    $normalized = $Name.Replace('/', '\')
    $normalized -like "Scripts\*" -or
        $normalized -like "robotcloud-shims\*" -or
        $normalized -like "conda-meta\*"
}

function Test-ArchiveEntryCanRepair {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Name
    )

    $normalized = $Name.Replace('/', '\')
    return $normalized -match "(^|\\)Library\\lib\\gdk-pixbuf-2\.0\\[^\\]+\\loaders\.cache$"
}

function Get-RuntimeZipPortabilityHits {
    param(
        [Parameter(Mandatory = $true)]
        [string] $ZipPath
    )

    $forbiddenRegexes = @(
        "Documents\\Codex",
        "\.runtime-build"
    )
    $hits = New-Object System.Collections.Generic.List[string]
    $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        foreach ($entry in $archive.Entries) {
            if (Test-ArchiveEntryForForbiddenText -Entry $entry -ForbiddenRegexes $forbiddenRegexes) {
                $hits.Add($entry.FullName)
            }
            if ($hits.Count -ge 50) {
                break
            }
        }
    } finally {
        $archive.Dispose()
    }

    return @($hits)
}

function Repair-RuntimeZipPortable {
    param(
        [Parameter(Mandatory = $true)]
        [string] $ZipPath
    )

    $hits = @(Get-RuntimeZipPortabilityHits -ZipPath $ZipPath)
    if ($hits.Count -eq 0) {
        return
    }

    $unrepairable = @($hits | Where-Object { -not (Test-ArchiveEntryCanRepair -Name $_) })
    if ($unrepairable.Count -gt 0) {
        throw "Windows runtime zip contains build-machine absolute paths and must be rebuilt before MSI packaging:`n$($unrepairable -join "`n")"
    }

    $removeNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($hit in $hits) {
        [void]$removeNames.Add($hit)
    }

    $removed = 0
    $archive = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Update)
    try {
        foreach ($entry in @($archive.Entries)) {
            if ($removeNames.Contains($entry.FullName)) {
                $entry.Delete()
                $removed += 1
            }
        }
    } finally {
        $archive.Dispose()
    }

    if ($removed -gt 0) {
        Write-Host "Removed non-portable generated runtime cache entries from Windows runtime zip:"
        foreach ($hit in $hits) {
            Write-Host $hit
        }
    }
}

function Assert-RuntimeZipPortable {
    param(
        [Parameter(Mandatory = $true)]
        [string] $ZipPath
    )

    $hits = @(Get-RuntimeZipPortabilityHits -ZipPath $ZipPath)
    if ($hits.Count -gt 0) {
        throw "Windows runtime zip contains build-machine absolute paths and must be rebuilt or repaired before MSI packaging:`n$($hits -join "`n")"
    }
}

function Invoke-CheckedNative {
    param(
        [Parameter(Mandatory = $true)]
        [string] $FilePath,
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]] $Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE`: $FilePath $($Arguments -join ' ')"
    }
}

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

Repair-RuntimeZipPortable -ZipPath $RuntimeZip
Assert-RuntimeZipPortable -ZipPath $RuntimeZip

Invoke-CheckedNative pnpm install
Invoke-CheckedNative pnpm tauri build --bundles msi
