# Windows counterpart of build-robot-service.sh: stage VR-teleop artifacts
# from the third_party/operator submodule.
#   1. Build robot-service and stage it as a Tauri external binary:
#      src-tauri\binaries\robot-service-<target-triple>.exe
#   2. Copy the SO-101 mesh STLs referenced by the bundled URDF into
#      src-tauri\resources\assets\assets\ (fetched from the pinned
#      mujoco_menagerie commit when the submodule copy is missing).
#   3. Copy the SO-101 device descriptor YAML into src-tauri\resources\vr\.
# Staged outputs are gitignored; the operator submodule is the source of truth.

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$RepoRoot = Split-Path -Parent $Root
$OperatorRobot = Join-Path $RepoRoot "third_party\operator\robot"

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

if (-not (Test-Path (Join-Path $OperatorRobot "Cargo.toml"))) {
    throw "operator submodule missing; run: git submodule update --init third_party/operator"
}

# --- build robot-service -------------------------------------------------------
$TripleMatch = (rustc -Vv) | Select-String "^host: (.+)$"
if (-not $TripleMatch) { throw "could not determine target triple from rustc -Vv" }
$Triple = $TripleMatch.Matches[0].Groups[1].Value.Trim()

Push-Location $OperatorRobot
try {
    Invoke-CheckedNative cargo build --release -p robot-service
} finally {
    Pop-Location
}

$OutDir = Join-Path $Root "src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Built = Join-Path $OperatorRobot "target\release\robot-service.exe"
if (-not (Test-Path $Built)) { throw "built binary not found at $Built" }
Copy-Item -LiteralPath $Built -Destination (Join-Path $OutDir "robot-service-$Triple.exe") -Force
Write-Host "staged binaries\robot-service-$Triple.exe"

# --- stage mesh STLs referenced by the bundled URDF ----------------------------
$Urdf = Join-Path $Root "src-tauri\resources\assets\so101_new_calib.urdf"
$MeshSrc = Join-Path $RepoRoot "third_party\operator\examples\mujuco-arm-so101\assets\so101\assets"
$MeshDest = Join-Path $Root "src-tauri\resources\assets\assets"
if (-not (Test-Path $Urdf)) { throw "bundled URDF not found at $Urdf" }

$MeshNames = Select-String -Path $Urdf -Pattern 'assets/([^"]+\.stl)' -AllMatches |
    ForEach-Object { $_.Matches } |
    ForEach-Object { $_.Groups[1].Value } |
    Sort-Object -Unique
if (-not $MeshNames) { throw "no mesh references found in $Urdf" }

$Missing = @($MeshNames | Where-Object { -not (Test-Path (Join-Path $MeshSrc $_)) })
if ($Missing.Count -gt 0) {
    # Meshes are deliberately not vendored in operator; fetch the same pinned
    # mujoco_menagerie commit its prepare.sh uses (bash-free equivalent).
    $UpstreamRepo = "https://github.com/google-deepmind/mujoco_menagerie.git"
    $UpstreamCommit = "b846dd12bc459d776cccb3dee0b1d02acbf7a9c7"
    $UpstreamSubdir = "robotstudio_so101/assets"
    $Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("so101-meshes-" + [System.Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $Tmp | Out-Null
    try {
        Invoke-CheckedNative git -C $Tmp init -q
        Invoke-CheckedNative git -C $Tmp remote add origin $UpstreamRepo
        Invoke-CheckedNative git -C $Tmp fetch -q --depth=1 --filter=blob:none origin $UpstreamCommit
        Invoke-CheckedNative git -C $Tmp checkout -q FETCH_HEAD -- $UpstreamSubdir
        New-Item -ItemType Directory -Force -Path $MeshSrc | Out-Null
        Copy-Item -Path (Join-Path $Tmp ($UpstreamSubdir.Replace('/', '\') + "\*.stl")) -Destination $MeshSrc -Force
    } finally {
        Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
    }
}

New-Item -ItemType Directory -Force -Path $MeshDest | Out-Null
foreach ($Mesh in $MeshNames) {
    $Source = Join-Path $MeshSrc $Mesh
    if (-not (Test-Path $Source)) { throw "URDF references $Mesh but it is missing from $MeshSrc" }
    Copy-Item -LiteralPath $Source -Destination (Join-Path $MeshDest $Mesh) -Force
}
Write-Host "staged $($MeshNames.Count) mesh STL(s) into resources\assets\assets\"

# --- stage the SO-101 device descriptors (single + dual) ------------------------
$DescriptorDestDir = Join-Path $Root "src-tauri\resources\vr"
New-Item -ItemType Directory -Force -Path $DescriptorDestDir | Out-Null
foreach ($Descriptor in @("so101_real_descriptor.yaml", "so101_dual_real_descriptor.yaml")) {
    $DescriptorSrc = Join-Path $RepoRoot "third_party\operator\robot\configs\$Descriptor"
    if (-not (Test-Path $DescriptorSrc)) { throw "descriptor missing in operator submodule: $DescriptorSrc" }
    Copy-Item -LiteralPath $DescriptorSrc -Destination (Join-Path $DescriptorDestDir $Descriptor) -Force
    Write-Host "staged resources\vr\$Descriptor"
}
