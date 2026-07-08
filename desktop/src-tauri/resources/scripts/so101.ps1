param(
    [ValidateSet("info", "ports", "find-port", "cameras", "setup-follower", "setup-leader", "calibrate-follower", "calibrate-leader", "teleop", "save-pose", "record-reset-pose", "record-auto", "record")]
    [string] $Action = "info",

    [string] $FollowerPort = "",
    [string] $LeaderPort = "",
    [string] $CameraId = "",
    [string] $CameraConfigOverride = "",
    [int] $CameraIndex = 0,
    [int] $Width = 640,
    [int] $Height = 480,
    [int] $Fps = 30,
    [string] $RobotId = "so101_follower",
    [string] $TeleopId = "so101_leader",
    [string] $DatasetRepoId = "local/so101_desktop",
    [string] $DatasetRoot = "",
    [int] $Episodes = 1,
    [double] $EpisodeTimeS = 10,
    [double] $MinEpisodeTimeS = 2,
    [double] $MaxEpisodeTimeS = 60,
    [double] $ResetTimeS = 2,
    [string] $Task = "SO-101 desktop teleoperation",
    [double] $TeleopTimeS = 5,
    [double] $MaxRelativeTarget = 5.0,
    [switch] $DisplayData
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$ScriptRoot = $PSScriptRoot
$ResourceRoot = Split-Path -Parent $ScriptRoot
$EnvPath = $env:ROBOTCLOUD_LEROBOT_ENV
if ([string]::IsNullOrWhiteSpace($EnvPath)) {
    $EnvPath = Join-Path $ResourceRoot "runtime\win\lerobot-env"
}
$Shims = Join-Path $EnvPath "robotcloud-shims"
$Scripts = Join-Path $EnvPath "Scripts"
$Python = Join-Path $EnvPath "python.exe"

if (-not (Test-Path $Python)) {
    throw "LeRobot environment was not found at $EnvPath"
}

$env:PATH = $Shims + ";" +
            $Scripts + ";" +
            (Join-Path $EnvPath "Library\bin") + ";" +
            $EnvPath + ";" +
            $env:PATH
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONNOUSERSITE = "1"

$DataDir = $env:ROBOTCLOUD_DATA_DIR
if ([string]::IsNullOrWhiteSpace($DataDir)) {
    $DataDir = Join-Path $env:LOCALAPPDATA "RobotCloud\so101-data"
}
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

if ([string]::IsNullOrWhiteSpace($DatasetRoot)) {
    $DatasetRoot = Join-Path (Join-Path $DataDir "datasets") ($DatasetRepoId.Replace("/", "\"))
}

function Invoke-LeRobotModule {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Module,
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]] $Args
    )

    Write-Host "> $Python -m $Module $($Args -join ' ')"
    & $Python -m $Module @Args
}

function Invoke-RobotCloudPython {
    param(
        [Parameter(Mandatory = $true)]
        [string] $ScriptName,
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]] $Args
    )

    $ScriptPath = Join-Path $ScriptRoot $ScriptName
    if (-not (Test-Path $ScriptPath)) {
        throw "Could not find $ScriptPath"
    }

    Write-Host "> $Python $ScriptPath $($Args -join ' ')"
    & $Python $ScriptPath @Args
}

function Require-Port {
    param(
        [string] $Value,
        [string] $Name
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "$Name is required. Example: -$Name COM3"
    }
}

function Show-Ports {
    $Code = @'
import json
import re
from serial.tools import list_ports

try:
    from lerobot.scripts.lerobot_find_port import find_available_ports
except Exception:
    find_available_ports = None

def is_candidate(device="", description="", manufacturer="", hwid=""):
    text = " ".join(str(value or "") for value in (device, description, manufacturer, hwid)).lower()
    if "bluetooth" in text or "debug-console" in text:
        return False
    if re.fullmatch(r"com\d+", str(device or "").lower()):
        return True
    return any(token in text for token in ("usb", "acm", "serial", "ch340", "cp210", "ftdi", "wch"))

lerobot_ports = find_available_ports() if find_available_ports else []
items = []
seen = set()
for port in list_ports.comports():
    device = port.device
    if not is_candidate(device, port.description, port.manufacturer, port.hwid):
        continue
    seen.add(device)
    items.append({
        "device": device,
        "name": port.name,
        "description": port.description,
        "manufacturer": port.manufacturer,
        "hwid": port.hwid,
    })
for device in lerobot_ports:
    if device not in seen and is_candidate(device):
        items.append({"device": device})
print("LeRobot find-port USB serial candidates:")
for item in items:
    detail = " - ".join(str(item.get(key) or "") for key in ("description", "manufacturer", "hwid")).strip(" -")
    print(f"  {item['device']}" + (f" ({detail})" if detail else ""))
print("ROBOTCLOUD_PORTS_JSON=" + json.dumps(items, ensure_ascii=False))
'@
    $Code | & $Python -
}

function Show-Cameras {
    $OutDir = Join-Path $DataDir "captured_images"
    $Code = @'
import json
import sys
from pathlib import Path

output_dir = Path(sys.argv[1])
try:
    from lerobot.scripts.lerobot_find_cameras import find_and_print_cameras
except Exception as exc:
    raise SystemExit(f"Could not import lerobot camera finder: {exc}")

cameras = find_and_print_cameras("opencv")
output_dir.mkdir(parents=True, exist_ok=True)
print("ROBOTCLOUD_CAMERAS_JSON=" + json.dumps(cameras, ensure_ascii=False, default=str))
'@
    $Code | & $Python - $OutDir
}

if ([string]::IsNullOrWhiteSpace($CameraId)) {
    $CameraId = [string] $CameraIndex
}
if ($CameraId -match '^\d+$') {
    $CameraRef = $CameraId
} else {
    $CameraRef = '"' + ($CameraId.Replace('\', '\\').Replace('"', '\"')) + '"'
}

$CameraConfig = "{ front: {type: opencv, index_or_path: $CameraRef, width: $Width, height: $Height, fps: $Fps}}"
if (-not [string]::IsNullOrWhiteSpace($CameraConfigOverride)) {
    $CameraConfig = $CameraConfigOverride
}
$Display = $DisplayData.IsPresent.ToString().ToLowerInvariant()

switch ($Action) {
    "info" {
        Invoke-LeRobotModule "lerobot.scripts.lerobot_info"
    }
    "ports" {
        Show-Ports
    }
    "find-port" {
        Show-Ports
    }
    "cameras" {
        Show-Cameras
    }
    "setup-follower" {
        Require-Port $FollowerPort "FollowerPort"
        Invoke-LeRobotModule "lerobot.scripts.lerobot_setup_motors" "--robot.type=so101_follower" "--robot.port=$FollowerPort" "--robot.id=$RobotId"
    }
    "setup-leader" {
        Require-Port $LeaderPort "LeaderPort"
        Invoke-LeRobotModule "lerobot.scripts.lerobot_setup_motors" "--teleop.type=so101_leader" "--teleop.port=$LeaderPort" "--teleop.id=$TeleopId"
    }
    "calibrate-follower" {
        Require-Port $FollowerPort "FollowerPort"
        Invoke-LeRobotModule "lerobot.scripts.lerobot_calibrate" "--robot.type=so101_follower" "--robot.port=$FollowerPort" "--robot.id=$RobotId"
    }
    "calibrate-leader" {
        Require-Port $LeaderPort "LeaderPort"
        Invoke-LeRobotModule "lerobot.scripts.lerobot_calibrate" "--teleop.type=so101_leader" "--teleop.port=$LeaderPort" "--teleop.id=$TeleopId"
    }
    "teleop" {
        Require-Port $FollowerPort "FollowerPort"
        Require-Port $LeaderPort "LeaderPort"
        Invoke-LeRobotModule "lerobot.scripts.lerobot_teleoperate" `
            "--robot.type=so101_follower" `
            "--robot.port=$FollowerPort" `
            "--robot.id=$RobotId" `
            "--teleop.type=so101_leader" `
            "--teleop.port=$LeaderPort" `
            "--teleop.id=$TeleopId"
    }
    "save-pose" {
        Require-Port $FollowerPort "FollowerPort"
        Require-Port $LeaderPort "LeaderPort"
        Invoke-RobotCloudPython "robotcloud_save_pose.py" `
            "--robot.type=so101_follower" `
            "--robot.port=$FollowerPort" `
            "--robot.id=$RobotId" `
            "--robot.max_relative_target=$MaxRelativeTarget" `
            "--teleop.type=so101_leader" `
            "--teleop.port=$LeaderPort" `
            "--teleop.id=$TeleopId" `
            "--fps=$Fps"
    }
    "record-reset-pose" {
        Require-Port $FollowerPort "FollowerPort"
        Require-Port $LeaderPort "LeaderPort"
        Invoke-RobotCloudPython "robotcloud_save_pose.py" `
            "--robot.type=so101_follower" `
            "--robot.port=$FollowerPort" `
            "--robot.id=$RobotId" `
            "--robot.max_relative_target=$MaxRelativeTarget" `
            "--teleop.type=so101_leader" `
            "--teleop.port=$LeaderPort" `
            "--teleop.id=$TeleopId" `
            "--fps=$Fps"
    }
    "record-auto" {
        Require-Port $FollowerPort "FollowerPort"
        Require-Port $LeaderPort "LeaderPort"
        $DatasetParent = Split-Path -Parent $DatasetRoot
        if (-not [string]::IsNullOrWhiteSpace($DatasetParent)) {
            New-Item -ItemType Directory -Force -Path $DatasetParent | Out-Null
        }
        Invoke-RobotCloudPython "robotcloud_auto_record.py" `
            "--robot.type=so101_follower" `
            "--robot.port=$FollowerPort" `
            "--robot.cameras=$CameraConfig" `
            "--robot.id=$RobotId" `
            "--robot.max_relative_target=$MaxRelativeTarget" `
            "--teleop.type=so101_leader" `
            "--teleop.port=$LeaderPort" `
            "--teleop.id=$TeleopId" `
            "--dataset.repo_id=$DatasetRepoId" `
            "--dataset.root=$DatasetRoot" `
            "--dataset.num_episodes=$Episodes" `
            "--dataset.single_task=$Task" `
            "--dataset.push_to_hub=false" `
            "--dataset.streaming_encoding=true" `
            "--dataset.encoder_threads=2" `
            "--dataset.vcodec=h264" `
            "--min_episode_time_s=$MinEpisodeTimeS" `
            "--max_episode_time_s=$MaxEpisodeTimeS" `
            "--display_data=$Display"
    }
    "record" {
        Require-Port $FollowerPort "FollowerPort"
        Require-Port $LeaderPort "LeaderPort"
        $DatasetParent = Split-Path -Parent $DatasetRoot
        if (-not [string]::IsNullOrWhiteSpace($DatasetParent)) {
            New-Item -ItemType Directory -Force -Path $DatasetParent | Out-Null
        }
        Invoke-LeRobotModule "lerobot.scripts.lerobot_record" `
            "--robot.type=so101_follower" `
            "--robot.port=$FollowerPort" `
            "--robot.cameras=$CameraConfig" `
            "--robot.id=$RobotId" `
            "--robot.max_relative_target=$MaxRelativeTarget" `
            "--teleop.type=so101_leader" `
            "--teleop.port=$LeaderPort" `
            "--teleop.id=$TeleopId" `
            "--dataset.repo_id=$DatasetRepoId" `
            "--dataset.root=$DatasetRoot" `
            "--dataset.num_episodes=$Episodes" `
            "--dataset.episode_time_s=$EpisodeTimeS" `
            "--dataset.reset_time_s=$ResetTimeS" `
            "--dataset.single_task=$Task" `
            "--dataset.push_to_hub=false" `
            "--dataset.streaming_encoding=true" `
            "--dataset.encoder_threads=2" `
            "--dataset.vcodec=h264" `
            "--display_data=$Display"
    }
}
