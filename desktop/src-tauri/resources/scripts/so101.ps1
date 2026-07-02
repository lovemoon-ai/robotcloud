param(
    [ValidateSet("info", "ports", "cameras", "setup-follower", "setup-leader", "calibrate-follower", "calibrate-leader", "teleop", "record")]
    [string] $Action = "info",

    [string] $FollowerPort = "",
    [string] $LeaderPort = "",
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
$Scripts = Join-Path $EnvPath "Scripts"
$Python = Join-Path $EnvPath "python.exe"

if (-not (Test-Path $Python)) {
    throw "LeRobot environment was not found at $EnvPath"
}

$env:PATH = $Scripts + ";" +
            (Join-Path $EnvPath "Library\bin") + ";" +
            $EnvPath + ";" +
            $env:PATH
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

$DataDir = $env:ROBOTCLOUD_DATA_DIR
if ([string]::IsNullOrWhiteSpace($DataDir)) {
    $DataDir = Join-Path $env:LOCALAPPDATA "RobotCloud\so101-data"
}
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

if ([string]::IsNullOrWhiteSpace($DatasetRoot)) {
    $DatasetRoot = Join-Path (Join-Path $DataDir "datasets") ($DatasetRepoId.Replace("/", "\"))
}

function Invoke-LeRobot {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Tool,
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]] $Args
    )

    $Exe = Join-Path $Scripts "$Tool.exe"
    if (-not (Test-Path $Exe)) {
        throw "Could not find $Exe"
    }

    Write-Host "> $Tool $($Args -join ' ')"
    & $Exe @Args
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
    Write-Host "Windows serial ports:"
    $serialPorts = Get-CimInstance Win32_SerialPort -ErrorAction SilentlyContinue |
        Select-Object DeviceID, Name, Description, Manufacturer
    if ($serialPorts) {
        $serialPorts | Format-Table -AutoSize
    } else {
        Write-Host "  No COM ports found."
    }

    Write-Host ""
    Write-Host "USB serial-like devices:"
    $usbSerial = Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue |
        Where-Object {
            $_.DeviceID -match "^USB\\" -and (
                $_.DeviceID -match "VID_1A86|VID_10C4|VID_0403|CH340|CP210|FTDI|USB-SERIAL|USB Serial|SERIAL" -or
                $_.Name -match "CH340|CP210|FTDI|USB.*Serial|COM\d+"
            )
        } |
        Select-Object Name, Manufacturer, PNPClass, Status, DeviceID
    if ($usbSerial) {
        $usbSerial | Format-List
    } else {
        Write-Host "  No USB serial adapter found."
    }

    Write-Host ""
    Write-Host "PySerial port list:"
    & $Python -m serial.tools.list_ports
}

$CameraConfig = "{ front: {type: opencv, index_or_path: $CameraIndex, width: $Width, height: $Height, fps: $Fps}}"
$Display = $DisplayData.IsPresent.ToString().ToLowerInvariant()

switch ($Action) {
    "info" {
        Invoke-LeRobot "lerobot-info"
    }
    "ports" {
        Show-Ports
    }
    "cameras" {
        $OutDir = Join-Path $DataDir "captured_images"
        Invoke-LeRobot "lerobot-find-cameras" "opencv" "--output-dir" $OutDir "--record-time-s" "3"
    }
    "setup-follower" {
        Require-Port $FollowerPort "FollowerPort"
        Invoke-LeRobot "lerobot-setup-motors" "--robot.type=so101_follower" "--robot.port=$FollowerPort" "--robot.id=$RobotId"
    }
    "setup-leader" {
        Require-Port $LeaderPort "LeaderPort"
        Invoke-LeRobot "lerobot-setup-motors" "--teleop.type=so101_leader" "--teleop.port=$LeaderPort" "--teleop.id=$TeleopId"
    }
    "calibrate-follower" {
        Require-Port $FollowerPort "FollowerPort"
        Invoke-LeRobot "lerobot-calibrate" "--robot.type=so101_follower" "--robot.port=$FollowerPort" "--robot.id=$RobotId"
    }
    "calibrate-leader" {
        Require-Port $LeaderPort "LeaderPort"
        Invoke-LeRobot "lerobot-calibrate" "--teleop.type=so101_leader" "--teleop.port=$LeaderPort" "--teleop.id=$TeleopId"
    }
    "teleop" {
        Require-Port $FollowerPort "FollowerPort"
        Require-Port $LeaderPort "LeaderPort"
        Invoke-LeRobot "lerobot-teleoperate" `
            "--robot.type=so101_follower" `
            "--robot.port=$FollowerPort" `
            "--robot.cameras=$CameraConfig" `
            "--robot.id=$RobotId" `
            "--robot.max_relative_target=$MaxRelativeTarget" `
            "--teleop.type=so101_leader" `
            "--teleop.port=$LeaderPort" `
            "--teleop.id=$TeleopId" `
            "--fps=$Fps" `
            "--teleop_time_s=$TeleopTimeS" `
            "--display_data=$Display"
    }
    "record" {
        Require-Port $FollowerPort "FollowerPort"
        Require-Port $LeaderPort "LeaderPort"
        $DatasetParent = Split-Path -Parent $DatasetRoot
        if (-not [string]::IsNullOrWhiteSpace($DatasetParent)) {
            New-Item -ItemType Directory -Force -Path $DatasetParent | Out-Null
        }
        Invoke-LeRobot "lerobot-record" `
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
