"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { writePreparedDatasetUpload } from "@/desktop/preparedDatasetUpload";
import { useDesktopBridgeAvailability } from "@/hooks/useDesktopBridgeAvailable";
import { useAuthStore } from "@/store/useAuthStore";

type CameraForm = {
  id: string;
  width: number;
  height: number;
  fps: number;
};

type FormState = {
  followerPort: string;
  leaderPort: string;
  cameras: [CameraForm, CameraForm, CameraForm];
  robotId: string;
  teleopId: string;
  datasetRepoId: string;
  datasetRoot: string;
  episodes: number;
  episodeTimeS: number;
  minEpisodeTimeS: number;
  maxEpisodeTimeS: number;
  resetTimeS: number;
  teleopTimeS: number;
  maxRelativeTarget: number;
  displayData: boolean;
  useLerobotRecorder: boolean;
  task: string;
};

type PersistedSO101Settings = FormState & { cameraCount: number };

type TerminalPhase = "preparing" | "starting" | "ready" | "failed" | "closed";
type CheckPhase = "idle" | "checking" | "valid" | "invalid";
type CheckState = { phase: CheckPhase; message: string };
type PortKey = "followerPort" | "leaderPort";
type CameraConfigFieldId =
  | "camera0Id"
  | "camera0Width"
  | "camera0Height"
  | "camera0Fps"
  | "camera1Id"
  | "camera1Width"
  | "camera1Height"
  | "camera1Fps"
  | "camera2Id"
  | "camera2Width"
  | "camera2Height"
  | "camera2Fps";
type ConfigFieldId =
  | PortKey
  | "robotId"
  | "teleopId"
  | "datasetRepoId"
  | "datasetRoot"
  | "episodes"
  | "episodeTimeS"
  | "minEpisodeTimeS"
  | "maxEpisodeTimeS"
  | "resetTimeS"
  | "teleopTimeS"
  | "maxRelativeTarget"
  | "task"
  | CameraConfigFieldId;
type ActionConfigError = { field: ConfigFieldId; message: string };
type TerminalDisposable = { dispose: () => void };
type TerminalHandle = {
  write: (data: string) => void;
  focus: () => void;
  dispose: () => void;
  resize: (cols: number, rows: number) => void;
  onData: (cb: (data: string) => void) => TerminalDisposable;
  open: (element: HTMLElement) => void;
  element?: HTMLElement;
};
type TerminalStoreSnapshot = {
  phase: TerminalPhase;
  error: string | null;
  runtimeProgress: RuntimeProgressEvent | null;
};
type UploadReview = {
  datasetRepoId: string;
  datasetRoot: string;
  stats: DatasetUploadInspection;
  issues: string[];
};
type ActionId =
  | "info"
  | "find-port"
  | "setup-follower"
  | "setup-leader"
  | "calibrate-follower"
  | "calibrate-leader"
  | "teleop"
  | "record-reset-pose"
  | "record";

type ShellDialect = "posix" | "powershell";

const CONNECTION_STORAGE_KEY = "robotcloud-so101-connection";
const DEFAULT_CAMERA_COUNT = 1;
const MAX_CAMERAS = 3;
const MIN_UPLOAD_EPISODES = 1;
const MIN_UPLOAD_DURATION_SECONDS = 1;
const CLEAR_CURRENT_TERMINAL_INPUT = "\x01\x0b";
const cameraKeys = ["front", "side", "wrist"] as const;
const cameraLabels = ["Camera 0", "Camera 1", "Camera 2"] as const;

const initialCamera: CameraForm = {
  id: "",
  width: 640,
  height: 480,
  fps: 30
};

function defaultCamera(index: number): CameraForm {
  return {
    ...initialCamera,
    id: String(index)
  };
}

const initialForm: FormState = {
  followerPort: "",
  leaderPort: "",
  cameras: [
    defaultCamera(0),
    defaultCamera(1),
    defaultCamera(2)
  ],
  robotId: "so101_follower",
  teleopId: "so101_leader",
  datasetRepoId: "local/so101_desktop",
  datasetRoot: "",
  episodes: 1,
  episodeTimeS: 10,
  minEpisodeTimeS: 2,
  maxEpisodeTimeS: 60,
  resetTimeS: 2,
  teleopTimeS: 5,
  maxRelativeTarget: 5,
  displayData: true,
  useLerobotRecorder: true,
  task: ""
};

const idleCheck: CheckState = { phase: "idle", message: "" };

const actions: Array<{ id: ActionId; label: string }> = [
  { id: "info", label: "Info" },
  { id: "find-port", label: "Find port" },
  { id: "setup-follower", label: "Setup follower" },
  { id: "setup-leader", label: "Setup leader" },
  { id: "calibrate-follower", label: "Calibrate follower" },
  { id: "calibrate-leader", label: "Calibrate leader" },
  { id: "teleop", label: "Teleoperate" },
  { id: "record-reset-pose", label: "Reset pose" },
  { id: "record", label: "Record" }
];

const configFieldIds = new Set<string>([
  "followerPort",
  "leaderPort",
  "robotId",
  "teleopId",
  "datasetRepoId",
  "datasetRoot",
  "episodes",
  "episodeTimeS",
  "minEpisodeTimeS",
  "maxEpisodeTimeS",
  "resetTimeS",
  "teleopTimeS",
  "maxRelativeTarget",
  "task",
  "camera0Id",
  "camera0Width",
  "camera0Height",
  "camera0Fps",
  "camera1Id",
  "camera1Width",
  "camera1Height",
  "camera1Fps",
  "camera2Id",
  "camera2Width",
  "camera2Height",
  "camera2Fps"
]);

const configFieldByLabel: Record<string, ConfigFieldId> = {
  "Follower port": "followerPort",
  "Leader port": "leaderPort",
  "Robot ID": "robotId",
  "Teleop ID": "teleopId",
  "Dataset repo id": "datasetRepoId",
  "Dataset root": "datasetRoot",
  "Episodes": "episodes",
  "Episode seconds": "episodeTimeS",
  "Min episode seconds": "minEpisodeTimeS",
  "Max episode seconds": "maxEpisodeTimeS",
  "Reset seconds": "resetTimeS",
  "Teleop seconds": "teleopTimeS",
  "Max relative target": "maxRelativeTarget",
  "Task label": "task",
  "Camera 0": "camera0Id",
  "Camera 0 width": "camera0Width",
  "Camera 0 height": "camera0Height",
  "Camera 0 fps": "camera0Fps",
  "Camera 1": "camera1Id",
  "Camera 1 width": "camera1Width",
  "Camera 1 height": "camera1Height",
  "Camera 1 fps": "camera1Fps",
  "Camera 2": "camera2Id",
  "Camera 2 width": "camera2Width",
  "Camera 2 height": "camera2Height",
  "Camera 2 fps": "camera2Fps"
};

class ConfigValidationError extends Error {
  field: ConfigFieldId;

  constructor(label: string, field: ConfigFieldId) {
    super(`先配置 ${label}`);
    this.name = "ConfigValidationError";
    this.field = field;
  }
}

function shellDialect(status: DesktopStatus | null): ShellDialect {
  return status?.platform === "windows" ? "powershell" : "posix";
}

export function shellArg(value: string, dialect: ShellDialect = "posix") {
  if (dialect === "powershell") {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function cameraRef(value: string) {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  return `"${trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function isConfigFieldId(value: string): value is ConfigFieldId {
  return configFieldIds.has(value);
}

function configFieldForLabel(label: string) {
  return configFieldByLabel[label];
}

function cameraConfigField(index: number, key: "Id" | "Width" | "Height" | "Fps") {
  return `camera${index}${key}` as ConfigFieldId;
}

function configValidationErrorFrom(error: unknown): ActionConfigError | null {
  if (error instanceof ConfigValidationError) {
    return { field: error.field, message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = /^先配置 (.+)$/.exec(message);
  if (!match) return null;
  const field = configFieldForLabel(match[1]);
  return field ? { field, message } : null;
}

function requireValue(value: string, label: string, field = configFieldForLabel(label)) {
  const trimmed = value.trim();
  if (!trimmed) {
    if (field) throw new ConfigValidationError(label, field);
    throw new Error(`先配置 ${label}`);
  }
  return trimmed;
}

function requireNumber(
  value: number,
  label: string,
  options: { integer?: boolean; min?: number } = {},
  field = configFieldForLabel(label)
) {
  const min = options.min ?? Number.MIN_VALUE;
  if (!Number.isFinite(value) || value < min || (options.integer && !Number.isInteger(value))) {
    if (field) throw new ConfigValidationError(label, field);
    throw new Error(`先配置 ${label}`);
  }
  return value;
}

function desktopPathSeparator(status: DesktopStatus | null) {
  return status?.platform === "windows" ? "\\" : "/";
}

function trimTrailingPathSeparators(path: string, separator: string) {
  if (/^[A-Za-z]:[\\/]*$/.test(path)) {
    return `${path.slice(0, 2)}${separator}`;
  }
  if (/^[\\/]+$/.test(path)) {
    return separator;
  }
  return path.replace(/[\\/]+$/, "");
}

function pathSegments(value: string) {
  return value.split(/[\\/]+/).filter(Boolean);
}

function joinDesktopPath(status: DesktopStatus | null, root: string, ...parts: string[]) {
  const separator = desktopPathSeparator(status);
  const normalizedRoot = trimTrailingPathSeparators(root.trim(), separator);
  const suffix = parts.flatMap(pathSegments).join(separator);
  if (!normalizedRoot) return suffix;
  if (!suffix) return normalizedRoot;
  return `${normalizedRoot}${normalizedRoot.endsWith(separator) ? "" : separator}${suffix}`;
}

export function resolvedDatasetRoot(form: FormState, status: DesktopStatus | null) {
  const explicitRoot = form.datasetRoot.trim();
  if (explicitRoot) return explicitRoot;
  if (!status?.dataDir) return "";
  return joinDesktopPath(status, status.dataDir, "datasets", form.datasetRepoId);
}

function finiteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let cursor = value;
  let unitIndex = 0;
  while (cursor >= 1024 && unitIndex < units.length - 1) {
    cursor /= 1024;
    unitIndex += 1;
  }
  return `${cursor >= 10 || unitIndex === 0 ? cursor.toFixed(0) : cursor.toFixed(1)} ${units[unitIndex]}`;
}

function formatDuration(seconds: number | null | undefined) {
  if (!finiteNumber(seconds)) return "Unknown";
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

export function datasetUploadValidationIssues(stats: DatasetUploadInspection) {
  const issues: string[] = [];
  if (stats.fileCount < 1) {
    issues.push("No recorded files were found.");
  }
  if (stats.episodeCount < MIN_UPLOAD_EPISODES) {
    issues.push(`At least ${MIN_UPLOAD_EPISODES} recorded episode is required.`);
  }
  if (!finiteNumber(stats.durationSeconds)) {
    issues.push("Recording duration could not be read from meta/info.json.");
  } else if (stats.durationSeconds < MIN_UPLOAD_DURATION_SECONDS) {
    issues.push(`Recording duration must be at least ${MIN_UPLOAD_DURATION_SECONDS}s.`);
  }
  return issues;
}

function clampCameraCount(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_CAMERA_COUNT;
  return Math.min(MAX_CAMERAS, Math.max(DEFAULT_CAMERA_COUNT, Math.trunc(numeric)));
}

function toNumber(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function toFiniteNumber(value: unknown, fallback: number) {
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  if (typeof value === "string" && !value.trim()) return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function toPositiveInteger(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric);
}

function normalizeCamera(value: unknown, index: number): CameraForm {
  const source = value && typeof value === "object" ? (value as Partial<CameraForm>) : {};
  const fallback = defaultCamera(index);
  return {
    id: typeof source.id === "string" ? source.id : fallback.id,
    width: toNumber(source.width, fallback.width),
    height: toNumber(source.height, fallback.height),
    fps: toNumber(source.fps, fallback.fps)
  };
}

function applyDetectedCameraProfile(camera: CameraForm, result: ValidationResult): CameraForm {
  const width = toPositiveInteger(result.width);
  const height = toPositiveInteger(result.height);
  const fps = toPositiveInteger(result.fps);

  return {
    ...camera,
    width: width ?? camera.width,
    height: height ?? camera.height,
    fps: fps ?? camera.fps
  };
}

export function removeCameraAtIndex(
  cameras: [CameraForm, CameraForm, CameraForm],
  index: number
): [CameraForm, CameraForm, CameraForm] {
  const next = [...cameras] as [CameraForm, CameraForm, CameraForm];
  for (let cursor = index; cursor < MAX_CAMERAS - 1; cursor += 1) {
    next[cursor] = next[cursor + 1];
  }
  next[MAX_CAMERAS - 1] = defaultCamera(MAX_CAMERAS - 1);
  return next;
}

export function parseConnectionSettings(raw: string | null) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<FormState> & { cameraCount?: number };
    const camerasSource = Array.isArray(parsed.cameras) ? parsed.cameras : [];
    return {
      followerPort: typeof parsed.followerPort === "string" ? parsed.followerPort : initialForm.followerPort,
      leaderPort: typeof parsed.leaderPort === "string" ? parsed.leaderPort : initialForm.leaderPort,
      robotId: typeof parsed.robotId === "string" ? parsed.robotId : initialForm.robotId,
      teleopId: typeof parsed.teleopId === "string" ? parsed.teleopId : initialForm.teleopId,
      datasetRepoId: typeof parsed.datasetRepoId === "string" ? parsed.datasetRepoId : initialForm.datasetRepoId,
      datasetRoot: typeof parsed.datasetRoot === "string" ? parsed.datasetRoot : initialForm.datasetRoot,
      episodes: toFiniteNumber(parsed.episodes, initialForm.episodes),
      episodeTimeS: toFiniteNumber(parsed.episodeTimeS, initialForm.episodeTimeS),
      minEpisodeTimeS: toFiniteNumber(parsed.minEpisodeTimeS, initialForm.minEpisodeTimeS),
      maxEpisodeTimeS: toFiniteNumber(parsed.maxEpisodeTimeS, initialForm.maxEpisodeTimeS),
      resetTimeS: toFiniteNumber(parsed.resetTimeS, initialForm.resetTimeS),
      teleopTimeS: toFiniteNumber(parsed.teleopTimeS, initialForm.teleopTimeS),
      maxRelativeTarget: toFiniteNumber(parsed.maxRelativeTarget, initialForm.maxRelativeTarget),
      displayData: toBoolean(parsed.displayData, initialForm.displayData),
      useLerobotRecorder: toBoolean(parsed.useLerobotRecorder, initialForm.useLerobotRecorder),
      task: typeof parsed.task === "string" ? parsed.task : initialForm.task,
      cameras: [
        normalizeCamera(camerasSource[0], 0),
        normalizeCamera(camerasSource[1], 1),
        normalizeCamera(camerasSource[2], 2)
      ] as [CameraForm, CameraForm, CameraForm],
      cameraCount: clampCameraCount(parsed.cameraCount)
    } satisfies PersistedSO101Settings;
  } catch {
    return null;
  }
}

export function serializeConnectionSettings(form: FormState, cameraCount: number) {
  return JSON.stringify({
    followerPort: form.followerPort,
    leaderPort: form.leaderPort,
    robotId: form.robotId,
    teleopId: form.teleopId,
    datasetRepoId: form.datasetRepoId,
    datasetRoot: form.datasetRoot,
    episodes: form.episodes,
    episodeTimeS: form.episodeTimeS,
    minEpisodeTimeS: form.minEpisodeTimeS,
    maxEpisodeTimeS: form.maxEpisodeTimeS,
    resetTimeS: form.resetTimeS,
    teleopTimeS: form.teleopTimeS,
    maxRelativeTarget: form.maxRelativeTarget,
    displayData: form.displayData,
    useLerobotRecorder: form.useLerobotRecorder,
    task: form.task,
    cameras: form.cameras,
    cameraCount: clampCameraCount(cameraCount)
  });
}

function cameraConfigValue(form: FormState, cameraCount: number, required = false) {
  const entries = form.cameras
    .slice(0, cameraCount)
    .map((camera, index) => ({ camera, index, key: cameraKeys[index] ?? cameraKeys[0] }))
    .filter(({ camera }) => camera.id.trim())
    .map(({ camera, index, key }) => {
      const label = cameraLabels[index] ?? "Camera 0";
      const width = requireNumber(camera.width, `${label} width`, { integer: true, min: 1 }, cameraConfigField(index, "Width"));
      const height = requireNumber(camera.height, `${label} height`, { integer: true, min: 1 }, cameraConfigField(index, "Height"));
      const fps = requireNumber(camera.fps, `${label} fps`, { min: Number.MIN_VALUE }, cameraConfigField(index, "Fps"));
      return `${key}: {type: opencv, index_or_path: ${cameraRef(camera.id)}, width: ${width}, height: ${height}, fps: ${fps}}`;
    });

  if (!entries.length) {
    if (required) throw new ConfigValidationError("Camera 0", "camera0Id");
    return null;
  }
  return `{ ${entries.join(", ")} }`;
}

function cameraConfigArg(form: FormState, cameraCount: number, quote: (value: string) => string, required = false) {
  const value = cameraConfigValue(form, cameraCount, required);
  if (!value) return null;
  return `--robot.cameras=${quote(value)}`;
}

const lerobotModules: Record<string, string> = {
  "lerobot-calibrate": "lerobot.scripts.lerobot_calibrate",
  "lerobot-find-cameras": "lerobot.scripts.lerobot_find_cameras",
  "lerobot-find-port": "lerobot.scripts.lerobot_find_port",
  "lerobot-info": "lerobot.scripts.lerobot_info",
  "lerobot-record": "lerobot.scripts.lerobot_record",
  "lerobot-setup-motors": "lerobot.scripts.lerobot_setup_motors",
  "lerobot-teleoperate": "lerobot.scripts.lerobot_teleoperate"
};

// Always invoke via `python -m <module>` on every platform, never the `lerobot-*`
// console script, whose packaged shebang may not be relocatable (esp. on macOS).
function lerobotCommand(_status: DesktopStatus | null, command: string) {
  const moduleName = lerobotModules[command];
  if (!moduleName) throw new Error(`Unsupported LeRobot command: ${command}`);
  return `python -m ${moduleName}`;
}

// Build `python "<scripts-dir>/<scriptName>"` for a bundled RobotCloud Python script
// (status.scriptsDir points at the directory that holds them).
function bundledScriptCommand(
  status: DesktopStatus | null,
  scriptName: string,
  dialect: ShellDialect,
  quote: (value: string) => string
) {
  const dir = status?.scriptsDir;
  if (!dir) throw new Error("脚本路径不可用，请更新桌面应用");
  const sep = dialect === "powershell" ? "\\" : "/";
  return `python ${quote(`${dir}${sep}${scriptName}`)}`;
}

export function buildActionCommand(action: ActionId, form: FormState, status: DesktopStatus | null, cameraCount: number) {
  const dialect = shellDialect(status);
  const quote = (value: string) => shellArg(value, dialect);
  const followerPort = () => requireValue(form.followerPort, "Follower port");
  const leaderPort = () => requireValue(form.leaderPort, "Leader port");
  const robotId = () => requireValue(form.robotId, "Robot ID");
  const teleopId = () => requireValue(form.teleopId, "Teleop ID");

  switch (action) {
    case "info":
      return lerobotCommand(status, "lerobot-info");
    case "find-port":
      return lerobotCommand(status, "lerobot-find-port");
    case "setup-follower":
      return [
        lerobotCommand(status, "lerobot-setup-motors"),
        "--robot.type=so101_follower",
        `--robot.port=${quote(followerPort())}`,
        `--robot.id=${quote(robotId())}`
      ].join(" ");
    case "setup-leader":
      return [
        lerobotCommand(status, "lerobot-setup-motors"),
        "--teleop.type=so101_leader",
        `--teleop.port=${quote(leaderPort())}`,
        `--teleop.id=${quote(teleopId())}`
      ].join(" ");
    case "calibrate-follower":
      return [
        lerobotCommand(status, "lerobot-calibrate"),
        "--robot.type=so101_follower",
        `--robot.port=${quote(followerPort())}`,
        `--robot.id=${quote(robotId())}`
      ].join(" ");
    case "calibrate-leader":
      return [
        lerobotCommand(status, "lerobot-calibrate"),
        "--teleop.type=so101_leader",
        `--teleop.port=${quote(leaderPort())}`,
        `--teleop.id=${quote(teleopId())}`
      ].join(" ");
    case "teleop": {
      // Minimal teleoperate: robot + teleop type/port/id only. No cameras,
      // max_relative_target, fps, or display_data.
      const teleopParts = [
        lerobotCommand(status, "lerobot-teleoperate"),
        "--robot.type=so101_follower",
        `--robot.port=${quote(followerPort())}`,
        `--robot.id=${quote(robotId())}`,
        "--teleop.type=so101_leader",
        `--teleop.port=${quote(leaderPort())}`,
        `--teleop.id=${quote(teleopId())}`
      ];
      return teleopParts.join(" ");
    }
    case "record-reset-pose":
      return [
        bundledScriptCommand(status, "robotcloud_reset_pose.py", dialect, quote),
        "--robot.type=so101_follower",
        `--robot.port=${quote(followerPort())}`,
        `--robot.id=${quote(robotId())}`,
        `--robot.max_relative_target=${requireNumber(form.maxRelativeTarget, "Max relative target", { min: 0 })}`,
        "--teleop.type=so101_leader",
        `--teleop.port=${quote(leaderPort())}`,
        `--teleop.id=${quote(teleopId())}`,
        "--fps=30"
      ].join(" ");
    case "record": {
      const repoId = requireValue(form.datasetRepoId, "Dataset repo id");
      const datasetRoot = resolvedDatasetRoot(form, status);
      const episodes = requireNumber(form.episodes, "Episodes", { integer: true, min: 1 });

      if (!form.useLerobotRecorder) {
        // RobotCloud auto recorder (robotcloud_auto_record.py). Mirrors the Rust
        // `record-auto` action: min/max episode time instead of episode/reset seconds.
        const minEpisodeTimeS = requireNumber(form.minEpisodeTimeS, "Min episode seconds", { min: Number.MIN_VALUE });
        const maxEpisodeTimeS = requireNumber(form.maxEpisodeTimeS, "Max episode seconds", { min: Number.MIN_VALUE });
        const cameraArg = cameraConfigArg(form, cameraCount, quote, true);
        if (!cameraArg) throw new Error("先配置 Camera 0");
        const parts = [
          bundledScriptCommand(status, "robotcloud_auto_record.py", dialect, quote),
          "--robot.type=so101_follower",
          `--robot.port=${quote(followerPort())}`,
          cameraArg,
          `--robot.id=${quote(robotId())}`,
          `--robot.max_relative_target=${requireNumber(form.maxRelativeTarget, "Max relative target", { min: 0 })}`,
          "--teleop.type=so101_leader",
          `--teleop.port=${quote(leaderPort())}`,
          `--teleop.id=${quote(teleopId())}`,
          `--dataset.repo_id=${quote(repoId)}`,
          `--dataset.num_episodes=${episodes}`,
          `--dataset.single_task=${quote(requireValue(form.task, "Task label"))}`,
          "--dataset.push_to_hub=false",
          "--dataset.streaming_encoding=true",
          "--dataset.encoder_threads=2",
          "--dataset.vcodec=h264",
          `--min_episode_time_s=${minEpisodeTimeS}`,
          `--max_episode_time_s=${maxEpisodeTimeS}`,
          `--display_data=${form.displayData ? "true" : "false"}`
        ];
        if (datasetRoot) parts.splice(9, 0, `--dataset.root=${quote(datasetRoot)}`);
        return parts.join(" ");
      }

      // LeRobot original recorder (lerobot-record).
      const episodeTimeS = requireNumber(form.episodeTimeS, "Episode seconds", { min: Number.MIN_VALUE });
      const resetTimeS = requireNumber(form.resetTimeS, "Reset seconds", { min: 0 });
      const cameraArg = cameraConfigArg(form, cameraCount, quote, true);
      if (!cameraArg) throw new Error("先配置 Camera 0");
      const parts = [
        lerobotCommand(status, "lerobot-record"),
        "--robot.type=so101_follower",
        `--robot.port=${quote(followerPort())}`,
        `--robot.id=${quote(robotId())}`,
        `--robot.max_relative_target=${requireNumber(form.maxRelativeTarget, "Max relative target", { min: 0 })}`,
        cameraArg,
        "--teleop.type=so101_leader",
        `--teleop.port=${quote(leaderPort())}`,
        `--teleop.id=${quote(teleopId())}`,
        `--display_data=${form.displayData ? "true" : "false"}`,
        `--dataset.repo_id=${quote(repoId)}`,
        `--dataset.num_episodes=${episodes}`,
        `--dataset.single_task=${quote(requireValue(form.task, "Task label"))}`,
        "--dataset.push_to_hub=false",
        "--dataset.streaming_encoding=true",
        "--dataset.encoder_threads=2",
        "--dataset.vcodec=h264",
        `--dataset.episode_time_s=${episodeTimeS}`,
        `--dataset.reset_time_s=${resetTimeS}`,
      ];
      if (datasetRoot) parts.splice(10, 0, `--dataset.root=${quote(datasetRoot)}`);
      return parts.join(" ");
    }
  }
}

export const so101TestExports = {
  initialForm,
  parseConnectionSettings,
  serializeConnectionSettings,
  removeCameraAtIndex,
  resolvedDatasetRoot,
  buildActionCommand,
  CLEAR_CURRENT_TERMINAL_INPUT,
  datasetUploadValidationIssues,
  shellArg,
  resetPersistentTerminalForTest
};

function statusLabel(phase: TerminalPhase) {
  if (phase === "preparing") return "Preparing runtime";
  if (phase === "ready") return "Ready";
  if (phase === "failed") return "Failed";
  if (phase === "closed") return "Closed";
  return "Starting";
}

function runtimeProgressPercent(progress: RuntimeProgressEvent | null) {
  if (!progress || !progress.total || progress.total <= 0 || progress.current == null) return null;
  return Math.max(0, Math.min(100, Math.round((progress.current / progress.total) * 100)));
}

const persistentTerminalStore: {
  term: TerminalHandle | null;
  sessionId: string | null;
  shell: string | null;
  phase: TerminalPhase;
  error: string | null;
  runtimeProgress: RuntimeProgressEvent | null;
  starting: Promise<void> | null;
  inputDisposable: TerminalDisposable | null;
  offOutput: (() => void) | null;
  offExit: (() => void) | null;
  resizeObserver: ResizeObserver | null;
  host: HTMLDivElement | null;
  listeners: Set<() => void>;
} = {
  term: null,
  sessionId: null,
  shell: null,
  phase: "starting",
  error: null,
  runtimeProgress: null,
  starting: null,
  inputDisposable: null,
  offOutput: null,
  offExit: null,
  resizeObserver: null,
  host: null,
  listeners: new Set()
};

function persistentTerminalSnapshot(): TerminalStoreSnapshot {
  return {
    phase: persistentTerminalStore.phase,
    error: persistentTerminalStore.error,
    runtimeProgress: persistentTerminalStore.runtimeProgress
  };
}

function notifyPersistentTerminalListeners() {
  persistentTerminalStore.listeners.forEach((listener) => listener());
}

function subscribePersistentTerminal(listener: () => void) {
  persistentTerminalStore.listeners.add(listener);
  return () => {
    persistentTerminalStore.listeners.delete(listener);
  };
}

function setPersistentTerminalState(phase: TerminalPhase, error: string | null) {
  persistentTerminalStore.phase = phase;
  persistentTerminalStore.error = error;
  if (phase !== "preparing") {
    persistentTerminalStore.runtimeProgress = null;
  }
  notifyPersistentTerminalListeners();
}

function setPersistentTerminalError(error: string | null) {
  persistentTerminalStore.error = error;
  notifyPersistentTerminalListeners();
}

function setPersistentRuntimeProgress(progress: RuntimeProgressEvent | null) {
  persistentTerminalStore.runtimeProgress = progress;
  notifyPersistentTerminalListeners();
}

function disconnectPersistentTerminalResize() {
  persistentTerminalStore.resizeObserver?.disconnect();
  persistentTerminalStore.resizeObserver = null;
}

function resizePersistentTerminal(container: HTMLDivElement) {
  const term = persistentTerminalStore.term;
  const sessionId = persistentTerminalStore.sessionId;
  if (!term || !sessionId) return;
  const cols = Math.max(40, Math.floor(container.clientWidth / 8));
  const rows = Math.max(14, Math.floor(container.clientHeight / 17));
  term.resize(cols, rows);
  window.robotcloudDesktop?.terminal.resize(sessionId, cols, rows).catch(() => undefined);
}

function attachPersistentTerminal(container: HTMLDivElement) {
  const term = persistentTerminalStore.term;
  if (!term) return;
  persistentTerminalStore.host = container;
  if (term.element) {
    container.replaceChildren(term.element);
  }
  disconnectPersistentTerminalResize();
  if (typeof ResizeObserver === "undefined") {
    resizePersistentTerminal(container);
  } else {
    persistentTerminalStore.resizeObserver = new ResizeObserver(() => resizePersistentTerminal(container));
    persistentTerminalStore.resizeObserver.observe(container);
    resizePersistentTerminal(container);
  }
  term.focus();
}

function ensurePersistentTerminalListeners(bridge: DesktopBridge) {
  if (!persistentTerminalStore.offOutput) {
    persistentTerminalStore.offOutput = bridge.terminal.onOutput((event) => {
      if (event.sessionId === persistentTerminalStore.sessionId) {
        persistentTerminalStore.term?.write(event.data);
      }
    });
  }

  if (!persistentTerminalStore.offExit) {
    persistentTerminalStore.offExit = bridge.terminal.onExit((event) => {
      if (event.sessionId === persistentTerminalStore.sessionId) {
        persistentTerminalStore.term?.write(`\r\n[terminal exited: code=${event.code ?? "null"}]\r\n`);
        persistentTerminalStore.sessionId = null;
        setPersistentTerminalState("closed", persistentTerminalStore.error);
      }
    });
  }
}

function ensurePersistentTerminal(
  bridge: DesktopBridge,
  container: HTMLDivElement,
  options: { onRuntimePrepared?: () => Promise<void> | void } = {}
) {
  persistentTerminalStore.host = container;
  ensurePersistentTerminalListeners(bridge);

  if (persistentTerminalStore.term) {
    attachPersistentTerminal(container);
    notifyPersistentTerminalListeners();
    return;
  }

  if (persistentTerminalStore.starting) {
    persistentTerminalStore.starting.then(() => {
      if (persistentTerminalStore.host) {
        attachPersistentTerminal(persistentTerminalStore.host);
      }
    });
    return;
  }

  setPersistentTerminalState("preparing", null);
  setPersistentRuntimeProgress({
    phase: "preparing",
    message: "Preparing LeRobot runtime...",
    current: null,
    total: null
  });
  persistentTerminalStore.starting = (async () => {
    let offRuntimeProgress: (() => void) | null = null;
    try {
      offRuntimeProgress = bridge.runtime?.onProgress?.((event) => {
        setPersistentRuntimeProgress(event);
      }) ?? null;
      if (bridge.runtime?.prepare) {
        await bridge.runtime.prepare();
        await options.onRuntimePrepared?.();
      }
    } finally {
      offRuntimeProgress?.();
    }
    setPersistentTerminalState("starting", null);
    const [{ Terminal }, session] = await Promise.all([
      import("@xterm/xterm"),
      bridge.terminal.start()
    ]);
    const term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "Cascadia Mono, Consolas, monospace",
      fontSize: 13,
      theme: {
        background: "#07111f",
        foreground: "#d9e8f2",
        cursor: "#78dcca",
        selectionBackground: "#28465f"
      }
    }) as TerminalHandle;
    const host = persistentTerminalStore.host ?? container;
    persistentTerminalStore.term = term;
    persistentTerminalStore.sessionId = session.sessionId;
    persistentTerminalStore.shell = session.shell;
    term.open(host);
    term.write(`RobotCloud terminal: ${session.shell}\r\n`);
    persistentTerminalStore.inputDisposable = term.onData((data) => {
      const sessionId = persistentTerminalStore.sessionId;
      if (sessionId) {
        window.robotcloudDesktop?.terminal.write(sessionId, data).catch(() => undefined);
      }
    });
    if (persistentTerminalStore.host) {
      attachPersistentTerminal(persistentTerminalStore.host);
    }
    setPersistentTerminalState("ready", null);
  })()
    .catch((error) => {
      setPersistentTerminalState("failed", String(error));
    })
    .finally(() => {
      persistentTerminalStore.starting = null;
    });
}

function disposePersistentTerminalInstance() {
  disconnectPersistentTerminalResize();
  persistentTerminalStore.inputDisposable?.dispose();
  const terminalElement = persistentTerminalStore.term?.element;
  persistentTerminalStore.term?.dispose();
  terminalElement?.remove();
  persistentTerminalStore.term = null;
  persistentTerminalStore.sessionId = null;
  persistentTerminalStore.shell = null;
  persistentTerminalStore.inputDisposable = null;
}

function restartPersistentTerminal(bridge: DesktopBridge, container: HTMLDivElement) {
  disposePersistentTerminalInstance();
  setPersistentTerminalState("starting", null);
  ensurePersistentTerminal(bridge, container);
}

function resetPersistentTerminalForTest() {
  disposePersistentTerminalInstance();
  persistentTerminalStore.offOutput?.();
  persistentTerminalStore.offExit?.();
  persistentTerminalStore.phase = "starting";
  persistentTerminalStore.error = null;
  persistentTerminalStore.runtimeProgress = null;
  persistentTerminalStore.starting = null;
  persistentTerminalStore.offOutput = null;
  persistentTerminalStore.offExit = null;
  persistentTerminalStore.host = null;
  persistentTerminalStore.listeners.clear();
}

function CheckButton({
  state,
  onClick,
  disabled
}: {
  state: CheckState;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || state.phase === "checking"}
        className="rounded-md border border-theme px-3 py-2 text-xs font-semibold accent-text transition hover:accent-bg disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state.phase === "checking" ? "Checking" : "Check"}
      </button>
      {state.phase === "valid" ? <span className="text-lg font-bold text-green-500">✓</span> : null}
      {state.phase === "invalid" ? <span className="text-sm font-semibold text-red-400">!</span> : null}
    </div>
  );
}

export function SO101Client() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const desktopBridgeAvailability = useDesktopBridgeAvailability();
  const [form, setForm] = useState<FormState>(initialForm);
  const [cameraCount, setCameraCount] = useState(DEFAULT_CAMERA_COUNT);
  const [connectionLoaded, setConnectionLoaded] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState<ActionId | null>(null);
  const [uploadPreparing, setUploadPreparing] = useState(false);
  const [actionConfigError, setActionConfigError] = useState<ActionConfigError | null>(null);
  const [highlightedField, setHighlightedField] = useState<ConfigFieldId | null>(null);
  const [uploadReview, setUploadReview] = useState<UploadReview | null>(null);
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [terminalState, setTerminalState] = useState<TerminalStoreSnapshot>(() => persistentTerminalSnapshot());
  const [terminalContainerEl, setTerminalContainerEl] = useState<HTMLDivElement | null>(null);
  const configInputRefs = useRef<Partial<Record<ConfigFieldId, HTMLInputElement | null>>>({});
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [portChecks, setPortChecks] = useState<Record<PortKey, CheckState>>({
    followerPort: idleCheck,
    leaderPort: idleCheck
  });
  const [cameraChecks, setCameraChecks] = useState<[CheckState, CheckState, CheckState]>([
    idleCheck,
    idleCheck,
    idleCheck
  ]);
  const [previewingCamera, setPreviewingCamera] = useState<number | null>(null);
  const lastWrittenActionCommandRef = useRef<string | null>(null);
  // Track whether the user has run "Reset pose" this session. The RobotCloud auto
  // recorder depends on a reset pose being set first.
  const [resetPoseConfigured, setResetPoseConfigured] = useState(false);
  const [resetPoseRequired, setResetPoseRequired] = useState(false);
  const resetPoseButtonRef = useRef<HTMLButtonElement | null>(null);
  const autoRecordNeedsResetPose = (action: ActionId) =>
    action === "record" && !form.useLerobotRecorder && !resetPoseConfigured;
  const terminalPhase = terminalState.phase;
  const terminalError = terminalState.error;
  const runtimeProgress = terminalState.runtimeProgress;
  const runtimePercent = runtimeProgressPercent(runtimeProgress);
  const bridgeReady = desktopBridgeAvailability === "available";
  const registerConfigInput = (field: ConfigFieldId) => (node: HTMLInputElement | null) => {
    configInputRefs.current[field] = node;
  };
  const fieldErrorId = (field: ConfigFieldId) => `so101-${field}-error`;
  const configInputClass = (field: ConfigFieldId, backgroundClass = "bg-surface") => {
    const highlightClass = highlightedField === field
      ? "border-red-500 ring-2 ring-red-500/60 shadow-[0_0_0_1px_rgba(239,68,68,0.45)]"
      : "border-theme";
    return `mt-1 w-full rounded-md border ${backgroundClass} p-2 text-body transition ${highlightClass}`;
  };
  const configInputA11y = (field: ConfigFieldId) => ({
    "aria-invalid": actionConfigError?.field === field ? true : undefined,
    "aria-describedby": actionConfigError?.field === field ? fieldErrorId(field) : undefined
  });
  const renderConfigFieldError = (field: ConfigFieldId) => {
    if (actionConfigError?.field !== field) return null;
    return (
      <p id={fieldErrorId(field)} className="mt-1 text-xs font-semibold text-red-500">
        {actionConfigError.message}
      </p>
    );
  };
  const clearConfigErrorForField = useCallback((field: ConfigFieldId) => {
    setActionConfigError((current) => (current?.field === field ? null : current));
    setHighlightedField((current) => (current === field ? null : current));
  }, []);
  const focusConfigField = useCallback((field: ConfigFieldId) => {
    setHighlightedField(field);
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedField((current) => (current === field ? null : current));
      highlightTimerRef.current = null;
    }, 3000);

    const focus = () => {
      const node = configInputRefs.current[field];
      if (!node) return;
      node.scrollIntoView?.({ block: "center", inline: "nearest" });
      node.focus();
      try {
        node.select();
      } catch {
        // Some numeric inputs do not support programmatic selection in every browser.
      }
    };
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(focus);
    } else {
      setTimeout(focus, 0);
    }
  }, []);
  const handleConfigValidationError = useCallback((error: unknown) => {
    const configError = configValidationErrorFrom(error);
    if (!configError) return false;
    setPersistentTerminalError(null);
    setActionConfigError(configError);
    focusConfigField(configError.field);
    return true;
  }, [focusConfigField]);

  useEffect(() => {
    if (!token) {
      router.replace("/login?next=%2Fso101");
    }
  }, [router, token]);

  useEffect(() => {
    const syncTerminalState = () => setTerminalState(persistentTerminalSnapshot());
    syncTerminalState();
    return subscribePersistentTerminal(syncTerminalState);
  }, []);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const saved = parseConnectionSettings(window.localStorage.getItem(CONNECTION_STORAGE_KEY));
    if (saved) {
      const { cameraCount: savedCameraCount, ...savedForm } = saved;
      setForm((current) => ({ ...current, ...savedForm }));
      setCameraCount(savedCameraCount);
    }
    setConnectionLoaded(true);
  }, []);

  useEffect(() => {
    if (!connectionLoaded) return;
    window.localStorage.setItem(
      CONNECTION_STORAGE_KEY,
      serializeConnectionSettings(form, cameraCount)
    );
  }, [cameraCount, connectionLoaded, form]);

  useEffect(() => {
    if (token && desktopBridgeAvailability === "unavailable") {
      router.replace("/");
    }
  }, [desktopBridgeAvailability, router, token]);

  const updateField = <K extends keyof Omit<FormState, "cameras">>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (isConfigFieldId(String(key))) {
      clearConfigErrorForField(String(key) as ConfigFieldId);
    }
    if (key === "followerPort" || key === "leaderPort") {
      setPortChecks((current) => ({ ...current, [key]: idleCheck }));
    }
  };

  const updateCamera = <K extends keyof CameraForm>(index: number, key: K, value: CameraForm[K]) => {
    setForm((current) => {
      const cameras = [...current.cameras] as [CameraForm, CameraForm, CameraForm];
      cameras[index] = { ...cameras[index], [key]: value };
      return { ...current, cameras };
    });
    clearConfigErrorForField(cameraConfigField(index, key === "id" ? "Id" : key === "width" ? "Width" : key === "height" ? "Height" : "Fps"));
    setCameraChecks((current) => {
      const next = [...current] as [CheckState, CheckState, CheckState];
      next[index] = idleCheck;
      return next;
    });
  };

  const addCamera = () => {
    const nextCount = Math.min(MAX_CAMERAS, cameraCount + 1);
    if (nextCount === cameraCount) return;
    const addedIndex = nextCount - 1;
    setForm((currentForm) => {
      const cameras = [...currentForm.cameras] as [CameraForm, CameraForm, CameraForm];
      if (!cameras[addedIndex].id.trim()) {
        cameras[addedIndex] = defaultCamera(addedIndex);
      }
      return { ...currentForm, cameras };
    });
    setCameraCount(nextCount);
  };

  const removeCamera = (index: number) => {
    if (index <= 0 || index >= cameraCount) return;
    setForm((currentForm) => ({
      ...currentForm,
      cameras: removeCameraAtIndex(currentForm.cameras, index)
    }));
    setCameraChecks((current) => {
      const next = [...current] as [CheckState, CheckState, CheckState];
      for (let cursor = index; cursor < MAX_CAMERAS - 1; cursor += 1) {
        next[cursor] = next[cursor + 1];
      }
      next[MAX_CAMERAS - 1] = idleCheck;
      return next;
    });
    setPreviewingCamera(null);
    setCameraCount((current) => Math.max(DEFAULT_CAMERA_COUNT, current - 1));
  };

  const terminalContainerRef = useCallback((node: HTMLDivElement | null) => {
    setTerminalContainerEl(node);
  }, []);

  const restartTerminal = () => {
    if (!window.robotcloudDesktop || !terminalContainerEl) return;
    restartPersistentTerminal(window.robotcloudDesktop, terminalContainerEl);
  };

  const refreshStatus = useCallback(async () => {
    if (!window.robotcloudDesktop) {
      setStatus({
        isDesktop: false,
        platform: "browser",
        appVersion: "browser",
        apiBaseUrl: "https://robotcloud.conductor-ai.top/api/v1",
        webUrl: "",
        runtimePath: null,
        runtimeReady: false,
        runtimeArchivePath: null,
        runtimeArchiveReady: false,
        runtimeError: null,
        scriptsDir: null,
        scriptReady: false,
        dataDir: ""
      });
      return;
    }
    setStatus(await window.robotcloudDesktop.status());
  }, []);

  useEffect(() => {
    if (!token || !bridgeReady) return;
    refreshStatus().catch((error) => setPersistentTerminalError(String(error)));
  }, [bridgeReady, refreshStatus, token]);

  useEffect(() => {
    if (!token || !bridgeReady || !window.robotcloudDesktop || !terminalContainerEl) return;
    ensurePersistentTerminal(window.robotcloudDesktop, terminalContainerEl, {
      onRuntimePrepared: () => refreshStatus().catch((error) => setPersistentTerminalError(String(error)))
    });
    return () => {
      if (persistentTerminalStore.host === terminalContainerEl) {
        persistentTerminalStore.host = null;
      }
      disconnectPersistentTerminalResize();
    };
  }, [bridgeReady, refreshStatus, terminalContainerEl, token]);

  const writeTerminalCommand = useCallback(async (command: string) => {
    const sessionId = persistentTerminalStore.sessionId;
    if (!sessionId || !window.robotcloudDesktop) {
      throw new Error("Terminal is not ready.");
    }
    await window.robotcloudDesktop.terminal.write(sessionId, `${CLEAR_CURRENT_TERMINAL_INPUT}${command}`);
    persistentTerminalStore.term?.focus();
  }, []);

  const writeActionCommand = useCallback(async (action: ActionId, options: { force?: boolean } = {}) => {
    const command = buildActionCommand(action, form, status, cameraCount);
    if (!options.force && command === lastWrittenActionCommandRef.current) return;
    lastWrittenActionCommandRef.current = command;
    try {
      await writeTerminalCommand(command);
    } catch (error) {
      if (lastWrittenActionCommandRef.current === command) {
        lastWrittenActionCommandRef.current = null;
      }
      throw error;
    }
  }, [cameraCount, form, status, writeTerminalCommand]);

  const runAction = async (action: ActionId) => {
    if (autoRecordNeedsResetPose(action)) {
      // Auto recorder needs a reset pose first: block, warn, and highlight the button.
      setResetPoseRequired(true);
      setSelectedAction(null);
      setPersistentTerminalError(null);
      setActionConfigError(null);
      requestAnimationFrame(() => {
        resetPoseButtonRef.current?.scrollIntoView?.({ block: "center", inline: "nearest" });
        resetPoseButtonRef.current?.focus?.();
      });
      return;
    }
    setResetPoseRequired(false);
    setSelectedAction(action);
    try {
      setPersistentTerminalError(null);
      setActionConfigError(null);
      await writeActionCommand(action, { force: true });
      if (action === "record-reset-pose") setResetPoseConfigured(true);
    } catch (error) {
      if (handleConfigValidationError(error)) return;
      setPersistentTerminalError(String(error));
    }
  };

  useEffect(() => {
    if (!selectedAction || terminalPhase !== "ready") return;
    // Don't auto-write a blocked auto-record command until a reset pose is set.
    if (selectedAction === "record" && !form.useLerobotRecorder && !resetPoseConfigured) return;
    let cancelled = false;
    writeActionCommand(selectedAction).catch((error) => {
      if (cancelled || configValidationErrorFrom(error)) return;
      setPersistentTerminalError(String(error));
    });
    return () => {
      cancelled = true;
    };
  }, [selectedAction, terminalPhase, writeActionCommand, form.useLerobotRecorder, resetPoseConfigured]);

  const requestDatasetUploadReview = async () => {
    try {
      if (!window.robotcloudDesktop?.dataset) {
        throw new Error("Desktop dataset bridge is not ready.");
      }
      const inspectUpload = window.robotcloudDesktop.dataset.inspectUpload;
      if (!inspectUpload) {
        throw new Error("Desktop app needs to be updated before upload validation is available.");
      }
      const datasetRepoId = requireValue(form.datasetRepoId, "Dataset repo id");
      const datasetRoot = requireValue(resolvedDatasetRoot(form, status), "Dataset root");
      setUploadPreparing(true);
      setActionConfigError(null);
      setPersistentTerminalError(null);
      const stats = await inspectUpload({
        datasetRoot,
        datasetRepoId
      });
      setUploadReview({
        datasetRepoId,
        datasetRoot: stats.datasetRoot || datasetRoot,
        stats,
        issues: datasetUploadValidationIssues(stats)
      });
    } catch (error) {
      setPersistentTerminalError(String(error));
    } finally {
      setUploadPreparing(false);
    }
  };

  const prepareDatasetUpload = async () => {
    if (!uploadReview || uploadReview.issues.length > 0) return;
    try {
      if (!window.robotcloudDesktop?.dataset) {
        throw new Error("Desktop dataset bridge is not ready.");
      }
      setUploadPreparing(true);
      setPersistentTerminalError(null);
      const prepared = await window.robotcloudDesktop.dataset.prepareUpload({
        datasetRoot: uploadReview.datasetRoot,
        datasetRepoId: uploadReview.datasetRepoId,
        task: form.task
      });
      writePreparedDatasetUpload(prepared);
      router.push("/datasets?source=so101");
    } catch (error) {
      if (handleConfigValidationError(error)) return;
      setPersistentTerminalError(String(error));
    } finally {
      setUploadPreparing(false);
    }
  };

  const checkPort = async (key: PortKey) => {
    if (!window.robotcloudDesktop) return;
    setPortChecks((current) => ({ ...current, [key]: { phase: "checking", message: "" } }));
    try {
      const result = await window.robotcloudDesktop.so101.validatePort(form[key]);
      setPortChecks((current) => ({
        ...current,
        [key]: { phase: result.ok ? "valid" : "invalid", message: result.message }
      }));
    } catch (error) {
      setPortChecks((current) => ({
        ...current,
        [key]: { phase: "invalid", message: String(error) }
      }));
    }
  };

  const checkCamera = async (index: number) => {
    if (!window.robotcloudDesktop) return;
    const camera = form.cameras[index];
    const requestedCameraId = camera.id;
    setCameraChecks((current) => {
      const next = [...current] as [CheckState, CheckState, CheckState];
      next[index] = { phase: "checking", message: "" };
      return next;
    });
    try {
      const result = await window.robotcloudDesktop.so101.validateCamera(camera.id, 0, 0);
      if (result.ok) {
        setForm((current) => {
          if (current.cameras[index].id !== requestedCameraId) return current;
          const cameras = [...current.cameras] as [CameraForm, CameraForm, CameraForm];
          cameras[index] = applyDetectedCameraProfile(cameras[index], result);
          return { ...current, cameras };
        });
      }
      setCameraChecks((current) => {
        const next = [...current] as [CheckState, CheckState, CheckState];
        next[index] = { phase: result.ok ? "valid" : "invalid", message: result.message };
        return next;
      });
    } catch (error) {
      setCameraChecks((current) => {
        const next = [...current] as [CheckState, CheckState, CheckState];
        next[index] = { phase: "invalid", message: String(error) };
        return next;
      });
    }
  };

  const previewCamera = async (index: number) => {
    if (!window.robotcloudDesktop) return;
    const camera = form.cameras[index];
    setPreviewingCamera(index);
    try {
      await window.robotcloudDesktop.so101.previewCamera(camera.id, camera.width, camera.height, camera.fps);
      setCameraChecks((current) => {
        const next = [...current] as [CheckState, CheckState, CheckState];
        next[index] = { phase: "valid", message: "Preview opened." };
        return next;
      });
    } catch (error) {
      setCameraChecks((current) => {
        const next = [...current] as [CheckState, CheckState, CheckState];
        next[index] = { phase: "invalid", message: String(error) };
        return next;
      });
    } finally {
      setPreviewingCamera(null);
    }
  };

  const statusCards = useMemo(
    () => [
      { label: "Runtime", value: status?.runtimeReady ? "ready" : "missing", detail: status?.runtimeError ?? status?.runtimePath ?? "not found" },
      { label: "Action commands", value: status?.runtimeReady ? "direct" : "pending", detail: status?.runtimeReady ? "python -m on Windows" : "waiting for runtime" },
      { label: "Data folder", value: "local", detail: status?.dataDir || "pending" },
      { label: "Cloud API", value: "online", detail: status?.apiBaseUrl ?? "https://robotcloud.conductor-ai.top/api/v1" }
    ],
    [status]
  );

  if (!token) {
    return (
      <main className="flex min-h-[calc(100vh-10rem)] items-center justify-center">
        <section className="w-full max-w-md rounded-lg border border-theme bg-card p-5 text-center">
          <p className="text-sm font-semibold accent-text">Login required</p>
          <p className="mt-2 text-xs text-muted">Redirecting to login before starting SO101 Desktop.</p>
        </section>
      </main>
    );
  }

  if (!bridgeReady) {
    return (
      <main className="flex min-h-[calc(100vh-10rem)] items-center justify-center">
        <section className="w-full max-w-md rounded-lg border border-theme bg-card p-5 text-center">
          <p className="text-sm font-semibold accent-text">Starting RobotCloud Desktop</p>
          <p className="mt-2 text-xs text-muted">Waiting for the local desktop bridge.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold text-body">SO101 Desktop Workbench</h1>
        <button
          type="button"
          onClick={() => refreshStatus()}
          className="rounded-md border border-theme px-3 py-2 text-sm font-semibold accent-text transition hover:accent-bg"
        >
          Refresh status
        </button>
      </header>

      <section className="rounded-lg border border-theme bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold accent-text">Terminal</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">{statusLabel(terminalPhase)}</span>
            {terminalPhase === "closed" || terminalPhase === "failed" ? (
              <button
                type="button"
                onClick={restartTerminal}
                className="rounded-md border border-theme px-3 py-1.5 text-xs font-semibold accent-text transition hover:accent-bg"
              >
                New terminal
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setActionsOpen((current) => !current)}
              aria-expanded={actionsOpen}
              aria-label="Toggle actions"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-theme text-lg font-semibold accent-text transition hover:accent-bg"
            >
              {actionsOpen ? "-" : "+"}
            </button>
          </div>
        </div>
        {actionsOpen ? (
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {actions.map((action) => {
              const isResetPose = action.id === "record-reset-pose";
              const highlight = isResetPose && resetPoseRequired;
              return (
                <button
                  key={action.id}
                  ref={isResetPose ? resetPoseButtonRef : undefined}
                  type="button"
                  onClick={() => runAction(action.id)}
                  disabled={terminalPhase !== "ready"}
                  className={`shrink-0 rounded-md border bg-surface px-3 py-2 text-sm font-semibold accent-text transition hover:border-primary disabled:cursor-not-allowed disabled:opacity-50 ${
                    highlight
                      ? "border-red-500 ring-2 ring-red-500/60 animate-pulse"
                      : "border-theme"
                  }`}
                >
                  {action.label}
                </button>
              );
            })}
          </div>
        ) : null}
        {resetPoseRequired ? (
          <p role="alert" className="mt-3 rounded-md border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-500">
            请先运行 Reset pose 设置初始位姿，再使用 RobotCloud 自动录制。
          </p>
        ) : null}
        {actionConfigError ? (
          <p role="alert" className="mt-3 rounded-md border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-500">
            {actionConfigError.message}
          </p>
        ) : null}
        {terminalPhase === "preparing" ? (
          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold accent-text">Preparing LeRobot runtime...</span>
              {runtimePercent == null ? null : <span className="text-muted">{runtimePercent}%</span>}
            </div>
            <div className="h-2 overflow-hidden rounded bg-surface">
              <div
                className="h-full gradient-primary transition-all"
                style={{ width: `${runtimePercent ?? 12}%` }}
              />
            </div>
            <p className="text-xs text-muted">
              {runtimeProgress?.message ?? "Preparing LeRobot runtime..."}
            </p>
          </div>
        ) : null}
        <div
          ref={terminalContainerRef}
          onClick={() => persistentTerminalStore.term?.focus()}
          className="mt-4 h-[30rem] overflow-hidden rounded-md border border-theme bg-[#07111f] p-2"
        />
        {terminalError ? <p className="mt-3 text-xs text-red-400">{terminalError}</p> : null}
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-lg border border-theme bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold accent-text">Connection</h2>
            </div>
            <div className="mt-4 grid gap-4">
              {([
                ["followerPort", "Follower port"],
                ["leaderPort", "Leader port"]
              ] as Array<[PortKey, string]>).map(([key, label]) => (
                <div key={key}>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="min-w-0 flex-1 text-sm">
                      <span className="text-muted">{label}</span>
                      <input
                        ref={registerConfigInput(key)}
                        value={form[key]}
                        onChange={(event) => updateField(key, event.target.value)}
                        placeholder="/dev/cu.usbmodem..."
                        className={configInputClass(key)}
                        {...configInputA11y(key)}
                      />
                    </label>
                    <CheckButton state={portChecks[key]} onClick={() => checkPort(key)} disabled={!form[key].trim()} />
                  </div>
                  {renderConfigFieldError(key)}
                  {portChecks[key].message ? <p className="mt-1 text-xs text-muted">{portChecks[key].message}</p> : null}
                </div>
              ))}

              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm">
                  <span className="text-muted">Robot ID</span>
                  <input
                    ref={registerConfigInput("robotId")}
                    value={form.robotId}
                    onChange={(event) => updateField("robotId", event.target.value)}
                    className={configInputClass("robotId")}
                    {...configInputA11y("robotId")}
                  />
                  {renderConfigFieldError("robotId")}
                </label>
                <label className="text-sm">
                  <span className="text-muted">Teleop ID</span>
                  <input
                    ref={registerConfigInput("teleopId")}
                    value={form.teleopId}
                    onChange={(event) => updateField("teleopId", event.target.value)}
                    className={configInputClass("teleopId")}
                    {...configInputA11y("teleopId")}
                  />
                  {renderConfigFieldError("teleopId")}
                </label>
              </div>

              {form.cameras.slice(0, cameraCount).map((camera, index) => {
                const idField = cameraConfigField(index, "Id");
                const widthField = cameraConfigField(index, "Width");
                const heightField = cameraConfigField(index, "Height");
                const fpsField = cameraConfigField(index, "Fps");
                return (
                <div key={cameraLabels[index]} className="rounded-md border border-theme bg-surface p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold accent-text">{cameraLabels[index]}</span>
                    {index > 0 ? (
                      <button
                        type="button"
                        onClick={() => removeCamera(index)}
                        aria-label={`Remove ${cameraLabels[index]}`}
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-theme text-base font-semibold accent-text transition hover:accent-bg"
                      >
                        -
                      </button>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="min-w-0 flex-1 text-sm">
                      <span className="text-muted">Camera id/path</span>
                      <input
                        ref={registerConfigInput(idField)}
                        value={camera.id}
                        onChange={(event) => updateCamera(index, "id", event.target.value)}
                        placeholder={String(index)}
                        className={configInputClass(idField, "bg-card")}
                        {...configInputA11y(idField)}
                      />
                    </label>
                    <CheckButton
                      state={cameraChecks[index]}
                      onClick={() => checkCamera(index)}
                      disabled={!camera.id.trim()}
                    />
                    <button
                      type="button"
                      onClick={() => previewCamera(index)}
                      disabled={!camera.id.trim() || previewingCamera === index}
                      className="rounded-md border border-theme px-3 py-2 text-xs font-semibold accent-text transition hover:accent-bg disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {previewingCamera === index ? "Opening" : "Preview"}
                    </button>
                  </div>
                  {renderConfigFieldError(idField)}
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <label className="text-xs text-muted">
                      Width
                      <input
                        ref={registerConfigInput(widthField)}
                        type="number"
                        value={camera.width}
                        onChange={(event) => updateCamera(index, "width", Number(event.target.value))}
                        className={configInputClass(widthField, "bg-card")}
                        {...configInputA11y(widthField)}
                      />
                      {renderConfigFieldError(widthField)}
                    </label>
                    <label className="text-xs text-muted">
                      Height
                      <input
                        ref={registerConfigInput(heightField)}
                        type="number"
                        value={camera.height}
                        onChange={(event) => updateCamera(index, "height", Number(event.target.value))}
                        className={configInputClass(heightField, "bg-card")}
                        {...configInputA11y(heightField)}
                      />
                      {renderConfigFieldError(heightField)}
                    </label>
                    <label className="text-xs text-muted">
                      FPS
                      <input
                        ref={registerConfigInput(fpsField)}
                        type="number"
                        value={camera.fps}
                        onChange={(event) => updateCamera(index, "fps", Number(event.target.value))}
                        className={configInputClass(fpsField, "bg-card")}
                        {...configInputA11y(fpsField)}
                      />
                      {renderConfigFieldError(fpsField)}
                    </label>
                  </div>
                  {cameraChecks[index].message ? <p className="mt-2 text-xs text-muted">{cameraChecks[index].message}</p> : null}
                </div>
              );
              })}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={addCamera}
                  disabled={cameraCount >= MAX_CAMERAS}
                  aria-label="Add camera"
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-theme text-lg font-semibold accent-text transition hover:accent-bg disabled:cursor-not-allowed disabled:opacity-40"
                >
                  +
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-theme bg-card p-5">
            <h2 className="text-xl font-semibold accent-text">Record</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-sm">
                <span className="text-muted">Dataset repo id</span>
                <input
                  ref={registerConfigInput("datasetRepoId")}
                  value={form.datasetRepoId}
                  onChange={(event) => updateField("datasetRepoId", event.target.value)}
                  className={configInputClass("datasetRepoId")}
                  {...configInputA11y("datasetRepoId")}
                />
                {renderConfigFieldError("datasetRepoId")}
              </label>
              <label className="text-sm">
                <span className="text-muted">Dataset root</span>
                <input
                  ref={registerConfigInput("datasetRoot")}
                  value={form.datasetRoot}
                  onChange={(event) => updateField("datasetRoot", event.target.value)}
                  className={configInputClass("datasetRoot")}
                  {...configInputA11y("datasetRoot")}
                />
                {renderConfigFieldError("datasetRoot")}
              </label>
              <label className="text-sm">
                <span className="text-muted">Episodes</span>
                <input
                  ref={registerConfigInput("episodes")}
                  type="number"
                  value={form.episodes}
                  onChange={(event) => updateField("episodes", Number(event.target.value))}
                  className={configInputClass("episodes")}
                  {...configInputA11y("episodes")}
                />
                {renderConfigFieldError("episodes")}
              </label>
              {form.useLerobotRecorder ? (
                <>
                  <label className="text-sm">
                    <span className="text-muted">Episode seconds</span>
                    <input
                      ref={registerConfigInput("episodeTimeS")}
                      type="number"
                      value={form.episodeTimeS}
                      onChange={(event) => updateField("episodeTimeS", Number(event.target.value))}
                      className={configInputClass("episodeTimeS")}
                      {...configInputA11y("episodeTimeS")}
                    />
                    {renderConfigFieldError("episodeTimeS")}
                  </label>
                  <label className="text-sm">
                    <span className="text-muted">Reset seconds</span>
                    <input
                      ref={registerConfigInput("resetTimeS")}
                      type="number"
                      value={form.resetTimeS}
                      onChange={(event) => updateField("resetTimeS", Number(event.target.value))}
                      className={configInputClass("resetTimeS")}
                      {...configInputA11y("resetTimeS")}
                    />
                    {renderConfigFieldError("resetTimeS")}
                  </label>
                </>
              ) : (
                <>
                  <label className="text-sm">
                    <span className="text-muted">Min episode seconds</span>
                    <input
                      ref={registerConfigInput("minEpisodeTimeS")}
                      type="number"
                      value={form.minEpisodeTimeS}
                      onChange={(event) => updateField("minEpisodeTimeS", Number(event.target.value))}
                      className={configInputClass("minEpisodeTimeS")}
                      {...configInputA11y("minEpisodeTimeS")}
                    />
                    {renderConfigFieldError("minEpisodeTimeS")}
                  </label>
                  <label className="text-sm">
                    <span className="text-muted">Max episode seconds</span>
                    <input
                      ref={registerConfigInput("maxEpisodeTimeS")}
                      type="number"
                      value={form.maxEpisodeTimeS}
                      onChange={(event) => updateField("maxEpisodeTimeS", Number(event.target.value))}
                      className={configInputClass("maxEpisodeTimeS")}
                      {...configInputA11y("maxEpisodeTimeS")}
                    />
                    {renderConfigFieldError("maxEpisodeTimeS")}
                  </label>
                </>
              )}
              <label className="text-sm">
                <span className="text-muted">Max relative target</span>
                <input
                  ref={registerConfigInput("maxRelativeTarget")}
                  type="number"
                  step="0.5"
                  value={form.maxRelativeTarget}
                  onChange={(event) => updateField("maxRelativeTarget", Number(event.target.value))}
                  className={configInputClass("maxRelativeTarget")}
                  {...configInputA11y("maxRelativeTarget")}
                />
                {renderConfigFieldError("maxRelativeTarget")}
              </label>
              <label className="text-sm md:col-span-2">
                <span className="text-muted">Task label</span>
                <input
                  ref={registerConfigInput("task")}
                  value={form.task}
                  onChange={(event) => updateField("task", event.target.value)}
                  placeholder="Descripe your task ..."
                  className={configInputClass("task")}
                  {...configInputA11y("task")}
                />
                {renderConfigFieldError("task")}
              </label>
              <label className="flex items-center gap-2 text-sm text-muted md:col-span-2">
                <input
                  type="checkbox"
                  checked={form.useLerobotRecorder}
                  onChange={(event) => {
                    updateField("useLerobotRecorder", event.target.checked);
                    if (event.target.checked) setResetPoseRequired(false);
                  }}
                />
                使用 LeRobot 原版录制工具（不勾选则用 RobotCloud 自动录制，需先设置 Reset pose）
              </label>
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={form.displayData} onChange={(event) => updateField("displayData", event.target.checked)} />
                Display LeRobot data windows
              </label>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={requestDatasetUploadReview}
                disabled={uploadPreparing}
                className="rounded-md gradient-primary px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploadPreparing ? "Checking..." : "Upload"}
              </button>
            </div>
          </section>
      </section>

      {uploadReview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-review-title"
            className="w-full max-w-lg rounded-lg border border-theme bg-card p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="upload-review-title" className="text-lg font-semibold accent-text">Recording upload review</h2>
                <p className="mt-1 break-all text-xs text-muted">{uploadReview.datasetRoot}</p>
              </div>
              <button
                type="button"
                onClick={() => setUploadReview(null)}
                aria-label="Close upload review"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-theme text-lg font-semibold accent-text transition hover:accent-bg"
              >
                ×
              </button>
            </div>

            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-theme bg-surface p-3">
                <dt className="text-xs uppercase tracking-wide text-muted">Episodes</dt>
                <dd className="mt-1 text-xl font-semibold text-body">{uploadReview.stats.episodeCount}</dd>
              </div>
              <div className="rounded-md border border-theme bg-surface p-3">
                <dt className="text-xs uppercase tracking-wide text-muted">Duration</dt>
                <dd className="mt-1 text-xl font-semibold text-body">{formatDuration(uploadReview.stats.durationSeconds)}</dd>
              </div>
              <div className="rounded-md border border-theme bg-surface p-3">
                <dt className="text-xs uppercase tracking-wide text-muted">Files</dt>
                <dd className="mt-1 text-xl font-semibold text-body">{uploadReview.stats.fileCount}</dd>
              </div>
              <div className="rounded-md border border-theme bg-surface p-3">
                <dt className="text-xs uppercase tracking-wide text-muted">Size</dt>
                <dd className="mt-1 text-xl font-semibold text-body">{formatBytes(uploadReview.stats.totalBytes)}</dd>
              </div>
              <div className="rounded-md border border-theme bg-surface p-3">
                <dt className="text-xs uppercase tracking-wide text-muted">Frames</dt>
                <dd className="mt-1 text-xl font-semibold text-body">{finiteNumber(uploadReview.stats.totalFrames) ? uploadReview.stats.totalFrames : "Unknown"}</dd>
              </div>
              <div className="rounded-md border border-theme bg-surface p-3">
                <dt className="text-xs uppercase tracking-wide text-muted">FPS</dt>
                <dd className="mt-1 text-xl font-semibold text-body">{finiteNumber(uploadReview.stats.fps) ? uploadReview.stats.fps : "Unknown"}</dd>
              </div>
            </dl>

            {uploadReview.issues.length ? (
              <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                <p className="font-semibold">Upload blocked</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {uploadReview.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-4 rounded-md border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-300">Ready to upload.</p>
            )}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setUploadReview(null)}
                className="rounded-md border border-theme px-4 py-2 text-sm font-semibold accent-text transition hover:accent-bg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={prepareDatasetUpload}
                disabled={uploadPreparing || uploadReview.issues.length > 0}
                className="rounded-md gradient-primary px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploadPreparing ? "Packaging..." : "Upload"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {statusCards.map((card) => (
          <div key={card.label} className="rounded-lg border border-theme bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-wide text-muted">{card.label}</span>
              <span className="rounded border border-theme px-2 py-0.5 text-xs accent-text">{card.value}</span>
            </div>
            <p className="mt-2 break-all text-xs text-muted">{card.detail}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
