"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { robotCloudApi, setRobotCloudApiBaseUrl } from "@/api/client";
import { writePreparedDatasetUpload } from "@/desktop/preparedDatasetUpload";
import { navigateToCloudPath, shouldUseLocalDesktopNavigation } from "@/desktop/navigation";
import { useDesktopBridgeAvailability } from "@/hooks/useDesktopBridgeAvailable";
import {
  inferenceJobServerAddress,
  normalizeInferenceServerAddress,
  selectCurrentActiveInferenceJob,
  selectCurrentRunningInferenceJob
} from "@/inference/jobs";
import { useAuthStore } from "@/store/useAuthStore";
import { useLocaleStore } from "@/store/useLocaleStore";
import type { InferenceJob } from "@/types";

type CameraForm = {
  name: string;
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
  stationaryHoldTimeS: number;
  resetTimeS: number;
  teleopTimeS: number;
  displayData: boolean;
  useLerobotRecorder: boolean;
  task: string;
  inferServerAddress: string;
  inferPolicyType: string;
  inferPolicyDevice: string;
  inferPretrainedNameOrPath: string;
  inferActionsPerChunk: string;
  inferChunkSizeThreshold: string;
  inferAggregateFnName: string;
};

type PersistedSO101Settings = FormState & { cameraCount: number };
type SO101ConnectionState = {
  form: FormState;
  cameraCount: number;
  raw: string | null;
};
type PendingDatasetUpload = DatasetPrepareUploadConfig & {
  createdAt: number;
};

type TerminalPhase = "preparing" | "starting" | "ready" | "failed" | "closed";
type CheckPhase = "idle" | "checking" | "valid" | "invalid";
type CheckState = { phase: CheckPhase; message: string };
type PortKey = "followerPort" | "leaderPort";
type CameraConfigFieldId =
  | "camera0Name"
  | "camera0Id"
  | "camera0Width"
  | "camera0Height"
  | "camera0Fps"
  | "camera1Name"
  | "camera1Id"
  | "camera1Width"
  | "camera1Height"
  | "camera1Fps"
  | "camera2Name"
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
  | "stationaryHoldTimeS"
  | "resetTimeS"
  | "teleopTimeS"
  | "task"
  | "inferServerAddress"
  | "inferPolicyType"
  | "inferPolicyDevice"
  | "inferPretrainedNameOrPath"
  | "inferActionsPerChunk"
  | "inferChunkSizeThreshold"
  | "inferAggregateFnName"
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
  runtimeProgressLog: string[];
};
type ActionId =
  | "info"
  | "find-port"
  | "setup-follower"
  | "setup-leader"
  | "calibrate-follower"
  | "calibrate-leader"
  | "teleop"
  | "save-pose"
  | "record"
  | "infer";
type ConfigSectionId = "connection" | "cameras" | "record" | "infer";
type RightPanelCardId = "commands" | ConfigSectionId | "status";
type ActionDefinition = {
  id: ActionId;
  label: string;
  group: "Diagnose" | "Setup" | "Operate" | "Data" | "Inference";
  sections: ConfigSectionId[];
};

type ShellDialect = "posix" | "powershell";

const CONNECTION_STORAGE_KEY = "robotcloud-so101-connection";
const DATASET_UPLOAD_PENDING_STORAGE_KEY = "robotcloud:so101-upload-pending";
const DATASET_UPLOAD_PENDING_TTL_MS = 6 * 60 * 60 * 1000;
const CONNECTION_STORAGE_VERSION = 5;
const DEFAULT_CAMERA_COUNT = 1;
const DEFAULT_MAX_RELATIVE_TARGET = 5;
const LEGACY_DEFAULT_EPISODES = 1;
const LEGACY_DEFAULT_CAMERA = { width: 480, height: 640, fps: 30 };
const MAX_RUNTIME_PROGRESS_LOG = 80;
const MAX_CAMERAS = 3;
const MIN_UPLOAD_EPISODES = 1;
const MIN_UPLOAD_DURATION_SECONDS = 1;
const CLEAR_CURRENT_TERMINAL_INPUT = "\x01\x0b";
const RUNTIME_UPDATE_COMMAND = "robotcloud-runtime-update";
const PREPARE_UPLOAD_COMMAND = "robotcloud-prepare-upload";
const numericTextInputProps = {
  type: "text",
  inputMode: "numeric"
} as const;
const cameraKeys = ["front", "side", "wrist"] as const;
const cameraLabels = ["Camera 0", "Camera 1", "Camera 2"] as const;

const initialCamera: CameraForm = {
  name: "front",
  id: "",
  width: 640,
  height: 480,
  fps: 30
};

function defaultCameraName(index: number) {
  return cameraKeys[index] ?? cameraKeys[0];
}

function defaultCamera(index: number): CameraForm {
  return {
    ...initialCamera,
    name: defaultCameraName(index),
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
  episodes: 50,
  episodeTimeS: 10,
  minEpisodeTimeS: 2,
  maxEpisodeTimeS: 60,
  stationaryHoldTimeS: 2,
  resetTimeS: 2,
  teleopTimeS: 5,
  displayData: true,
  useLerobotRecorder: true,
  task: "",
  inferServerAddress: "h20.conductor-ai.top:5161",
  inferPolicyType: "pi05",
  inferPolicyDevice: "cuda",
  inferPretrainedNameOrPath: "backend/storage/train_runs/task_14/checkpoints/last/pretrained_model",
  inferActionsPerChunk: "50",
  inferChunkSizeThreshold: "0.5",
  inferAggregateFnName: "weighted_average"
};

const idleCheck: CheckState = { phase: "idle", message: "" };

const actionDefinitions: ActionDefinition[] = [
  { id: "info", label: "Info", group: "Diagnose", sections: [] },
  { id: "find-port", label: "Find port", group: "Diagnose", sections: [] },
  { id: "setup-follower", label: "Setup follower", group: "Setup", sections: ["connection"] },
  { id: "setup-leader", label: "Setup leader", group: "Setup", sections: ["connection"] },
  { id: "calibrate-follower", label: "Calibrate follower", group: "Setup", sections: ["connection"] },
  { id: "calibrate-leader", label: "Calibrate leader", group: "Setup", sections: ["connection"] },
  { id: "teleop", label: "Teleoperate", group: "Operate", sections: ["connection"] },
  { id: "save-pose", label: "Save pose", group: "Operate", sections: ["connection"] },
  { id: "record", label: "Record", group: "Data", sections: ["connection", "cameras", "record"] },
  { id: "infer", label: "Infer", group: "Inference", sections: ["connection", "cameras", "infer"] }
];
const actionGroups: Array<{ label: ActionDefinition["group"]; actionIds: ActionId[] }> = [
  { label: "Diagnose", actionIds: ["info", "find-port"] },
  { label: "Setup", actionIds: ["setup-follower", "setup-leader", "calibrate-follower", "calibrate-leader"] },
  { label: "Operate", actionIds: ["teleop", "save-pose"] },
  { label: "Data", actionIds: ["record"] },
  { label: "Inference", actionIds: ["infer"] }
];
const rightPanelNavItems: Array<{ id: RightPanelCardId; label: string }> = [
  { id: "commands", label: "Commands" },
  { id: "connection", label: "Connection" },
  { id: "cameras", label: "Cameras" },
  { id: "record", label: "Record" },
  { id: "infer", label: "Infer" },
  { id: "status", label: "Status" }
];
const actionDefinitionById = Object.fromEntries(
  actionDefinitions.map((action) => [action.id, action])
) as Record<ActionId, ActionDefinition>;

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
  "stationaryHoldTimeS",
  "resetTimeS",
  "teleopTimeS",
  "task",
  "inferServerAddress",
  "inferPolicyType",
  "inferPolicyDevice",
  "inferPretrainedNameOrPath",
  "inferActionsPerChunk",
  "inferChunkSizeThreshold",
  "inferAggregateFnName",
  "camera0Name",
  "camera0Id",
  "camera0Width",
  "camera0Height",
  "camera0Fps",
  "camera1Name",
  "camera1Id",
  "camera1Width",
  "camera1Height",
  "camera1Fps",
  "camera2Name",
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
  "Stationary action seconds": "stationaryHoldTimeS",
  "Reset seconds": "resetTimeS",
  "Teleop seconds": "teleopTimeS",
  "Task label": "task",
  "Server address": "inferServerAddress",
  "Policy type": "inferPolicyType",
  "Policy device": "inferPolicyDevice",
  "Pretrained name or path": "inferPretrainedNameOrPath",
  "Actions per chunk": "inferActionsPerChunk",
  "Chunk size threshold": "inferChunkSizeThreshold",
  "Aggregate function": "inferAggregateFnName",
  "Camera 0 name": "camera0Name",
  "Camera 0": "camera0Id",
  "Camera 0 width": "camera0Width",
  "Camera 0 height": "camera0Height",
  "Camera 0 fps": "camera0Fps",
  "Camera 1 name": "camera1Name",
  "Camera 1": "camera1Id",
  "Camera 1 width": "camera1Width",
  "Camera 1 height": "camera1Height",
  "Camera 1 fps": "camera1Fps",
  "Camera 2 name": "camera2Name",
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

function encodeUploadCommandPayload(config: DatasetPrepareUploadConfig) {
  return encodeURIComponent(JSON.stringify(config));
}

export function buildPrepareUploadCommand(config: DatasetPrepareUploadConfig, status: DesktopStatus | null) {
  const dialect = shellDialect(status);
  return `${PREPARE_UPLOAD_COMMAND} ${shellArg(encodeUploadCommandPayload(config), dialect)}`;
}

function cameraRef(value: string) {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  return `"${trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function cameraNameKey(value: string) {
  const trimmed = value.trim();
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(trimmed)) return trimmed;
  return `"${trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function isConfigFieldId(value: string): value is ConfigFieldId {
  return configFieldIds.has(value);
}

function configFieldForLabel(label: string) {
  return configFieldByLabel[label];
}

function cameraConfigField(index: number, key: "Name" | "Id" | "Width" | "Height" | "Fps") {
  return `camera${index}${key}` as ConfigFieldId;
}

function configValidationErrorFrom(error: unknown): ActionConfigError | null {
  if (error instanceof ConfigValidationError) {
    return { field: error.field, message: error.message };
  }
  const message = messageFromUnknownError(error);
  const match = /^先配置 (.+)$/.exec(message);
  if (!match) return null;
  const field = configFieldForLabel(match[1]);
  return field ? { field, message } : null;
}

function messageFromUnknownError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

function requireValue(value: string, label: string, field = configFieldForLabel(label)) {
  const trimmed = value.trim();
  if (!trimmed) {
    if (field) throw new ConfigValidationError(label, field);
    throw new Error(`先配置 ${label}`);
  }
  return trimmed;
}

function requireInferenceServerAddress(value: string, label: string, field = configFieldForLabel(label)) {
  const normalized = normalizeInferenceServerAddress(requireValue(value, label, field));
  if (!normalized) {
    if (field) throw new ConfigValidationError(label, field);
    throw new Error(`先配置 ${label}`);
  }
  return normalized;
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

function requireNumericText(
  value: string,
  label: string,
  options: { integer?: boolean; min?: number } = {},
  field = configFieldForLabel(label)
) {
  const trimmed = requireValue(value, label, field);
  const numeric = Number(trimmed);
  const min = options.min ?? Number.MIN_VALUE;
  if (!Number.isFinite(numeric) || numeric < min || (options.integer && !Number.isInteger(numeric))) {
    if (field) throw new ConfigValidationError(label, field);
    throw new Error(`先配置 ${label}`);
  }
  return trimmed;
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

function versionText(value: string | null | undefined) {
  return value && value.trim() ? value : "unknown";
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

function hasCameraProfileValue(value: number) {
  return toPositiveInteger(value) !== null;
}

function cameraValidationValue(value: number) {
  return toPositiveInteger(value) ?? 0;
}

function normalizeCamera(value: unknown, index: number, migrateLegacyDefaults = false): CameraForm {
  const source = value && typeof value === "object" ? (value as Partial<CameraForm>) : {};
  const fallback = defaultCamera(index);
  const normalized = {
    name: typeof source.name === "string" && source.name.trim() ? source.name : fallback.name,
    id: typeof source.id === "string" ? source.id : fallback.id,
    width: toNumber(source.width, fallback.width),
    height: toNumber(source.height, fallback.height),
    fps: toNumber(source.fps, fallback.fps)
  };
  if (
    migrateLegacyDefaults &&
    normalized.width === LEGACY_DEFAULT_CAMERA.width &&
    normalized.height === LEGACY_DEFAULT_CAMERA.height &&
    normalized.fps === LEGACY_DEFAULT_CAMERA.fps
  ) {
    return { ...normalized, width: initialCamera.width, height: initialCamera.height };
  }
  return normalized;
}

function applyDetectedCameraProfile(camera: CameraForm, result: ValidationResult): CameraForm {
  const width = toPositiveInteger(result.width);
  const height = toPositiveInteger(result.height);

  return {
    ...camera,
    width: hasCameraProfileValue(camera.width) ? camera.width : width ?? camera.width,
    height: hasCameraProfileValue(camera.height) ? camera.height : height ?? camera.height
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
    const parsed = JSON.parse(raw) as Partial<FormState> & { cameraCount?: number; storageVersion?: number };
    const camerasSource = Array.isArray(parsed.cameras) ? parsed.cameras : [];
    const storageVersion = typeof parsed.storageVersion === "number" ? parsed.storageVersion : 0;
    const migrateLegacyDefaults = storageVersion < 3;
    const episodes = toFiniteNumber(parsed.episodes, initialForm.episodes);
    return {
      followerPort: typeof parsed.followerPort === "string" ? parsed.followerPort : initialForm.followerPort,
      leaderPort: typeof parsed.leaderPort === "string" ? parsed.leaderPort : initialForm.leaderPort,
      robotId: typeof parsed.robotId === "string" ? parsed.robotId : initialForm.robotId,
      teleopId: typeof parsed.teleopId === "string" ? parsed.teleopId : initialForm.teleopId,
      datasetRepoId: typeof parsed.datasetRepoId === "string" ? parsed.datasetRepoId : initialForm.datasetRepoId,
      datasetRoot: typeof parsed.datasetRoot === "string" ? parsed.datasetRoot : initialForm.datasetRoot,
      episodes: migrateLegacyDefaults && episodes === LEGACY_DEFAULT_EPISODES ? initialForm.episodes : episodes,
      episodeTimeS: toFiniteNumber(parsed.episodeTimeS, initialForm.episodeTimeS),
      minEpisodeTimeS: toFiniteNumber(parsed.minEpisodeTimeS, initialForm.minEpisodeTimeS),
      maxEpisodeTimeS: toFiniteNumber(parsed.maxEpisodeTimeS, initialForm.maxEpisodeTimeS),
      stationaryHoldTimeS: toFiniteNumber(parsed.stationaryHoldTimeS, initialForm.stationaryHoldTimeS),
      resetTimeS: toFiniteNumber(parsed.resetTimeS, initialForm.resetTimeS),
      teleopTimeS: toFiniteNumber(parsed.teleopTimeS, initialForm.teleopTimeS),
      displayData: toBoolean(parsed.displayData, initialForm.displayData),
      useLerobotRecorder: toBoolean(parsed.useLerobotRecorder, initialForm.useLerobotRecorder),
      task: typeof parsed.task === "string" ? parsed.task : initialForm.task,
      inferServerAddress:
        typeof parsed.inferServerAddress === "string"
          ? normalizeInferenceServerAddress(parsed.inferServerAddress)
          : initialForm.inferServerAddress,
      inferPolicyType: typeof parsed.inferPolicyType === "string" ? parsed.inferPolicyType : initialForm.inferPolicyType,
      inferPolicyDevice: typeof parsed.inferPolicyDevice === "string" ? parsed.inferPolicyDevice : initialForm.inferPolicyDevice,
      inferPretrainedNameOrPath: typeof parsed.inferPretrainedNameOrPath === "string" ? parsed.inferPretrainedNameOrPath : initialForm.inferPretrainedNameOrPath,
      inferActionsPerChunk: typeof parsed.inferActionsPerChunk === "string" ? parsed.inferActionsPerChunk : initialForm.inferActionsPerChunk,
      inferChunkSizeThreshold: typeof parsed.inferChunkSizeThreshold === "string" ? parsed.inferChunkSizeThreshold : initialForm.inferChunkSizeThreshold,
      inferAggregateFnName: typeof parsed.inferAggregateFnName === "string" ? parsed.inferAggregateFnName : initialForm.inferAggregateFnName,
      cameras: [
        normalizeCamera(camerasSource[0], 0, migrateLegacyDefaults),
        normalizeCamera(camerasSource[1], 1, migrateLegacyDefaults),
        normalizeCamera(camerasSource[2], 2, migrateLegacyDefaults)
      ] as [CameraForm, CameraForm, CameraForm],
      cameraCount: clampCameraCount(parsed.cameraCount)
    } satisfies PersistedSO101Settings;
  } catch {
    return null;
  }
}

export function serializeConnectionSettings(form: FormState, cameraCount: number) {
  return JSON.stringify({
    storageVersion: CONNECTION_STORAGE_VERSION,
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
    stationaryHoldTimeS: form.stationaryHoldTimeS,
    resetTimeS: form.resetTimeS,
    teleopTimeS: form.teleopTimeS,
    displayData: form.displayData,
    useLerobotRecorder: form.useLerobotRecorder,
    task: form.task,
    inferServerAddress: normalizeInferenceServerAddress(form.inferServerAddress),
    inferPolicyType: form.inferPolicyType,
    inferPolicyDevice: form.inferPolicyDevice,
    inferPretrainedNameOrPath: form.inferPretrainedNameOrPath,
    inferActionsPerChunk: form.inferActionsPerChunk,
    inferChunkSizeThreshold: form.inferChunkSizeThreshold,
    inferAggregateFnName: form.inferAggregateFnName,
    cameras: form.cameras,
    cameraCount: clampCameraCount(cameraCount)
  });
}

function connectionStateFromSettings(saved: PersistedSO101Settings | null, raw: string | null = null): SO101ConnectionState {
  if (!saved) {
    return {
      form: initialForm,
      cameraCount: DEFAULT_CAMERA_COUNT,
      raw: null
    };
  }
  const { cameraCount, ...form } = saved;
  return { form, cameraCount, raw };
}

function readLocalConnectionSettings(): SO101ConnectionState {
  if (typeof window === "undefined") {
    return connectionStateFromSettings(null);
  }
  const raw = window.localStorage.getItem(CONNECTION_STORAGE_KEY);
  return connectionStateFromSettings(parseConnectionSettings(raw), raw);
}

function writeLocalConnectionSettings(raw: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CONNECTION_STORAGE_KEY, raw);
}

async function readDesktopConnectionSettings(bridge: DesktopBridge) {
  const raw = await bridge.so101.getSettings?.();
  return connectionStateFromSettings(parseConnectionSettings(raw ?? null), raw ?? null);
}

function writeDesktopConnectionSettings(raw: string) {
  window.robotcloudDesktop?.so101.setSettings?.(raw).catch(() => undefined);
}

function parsePendingDatasetUpload(raw: string | null): PendingDatasetUpload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingDatasetUpload>;
    if (
      typeof parsed.datasetRoot !== "string" ||
      typeof parsed.datasetRepoId !== "string" ||
      typeof parsed.createdAt !== "number" ||
      !Number.isFinite(parsed.createdAt)
    ) {
      return null;
    }
    const ageMs = Date.now() - parsed.createdAt;
    if (ageMs < 0 || ageMs > DATASET_UPLOAD_PENDING_TTL_MS) {
      return null;
    }
    return {
      datasetRoot: parsed.datasetRoot,
      datasetRepoId: parsed.datasetRepoId,
      task: typeof parsed.task === "string" ? parsed.task : undefined,
      createdAt: parsed.createdAt
    };
  } catch {
    return null;
  }
}

function readPendingDatasetUpload(): PendingDatasetUpload | null {
  if (typeof window === "undefined" || typeof sessionStorage === "undefined") return null;
  const pending = parsePendingDatasetUpload(sessionStorage.getItem(DATASET_UPLOAD_PENDING_STORAGE_KEY));
  if (!pending) {
    sessionStorage.removeItem(DATASET_UPLOAD_PENDING_STORAGE_KEY);
  }
  return pending;
}

function writePendingDatasetUpload(config: DatasetPrepareUploadConfig): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(DATASET_UPLOAD_PENDING_STORAGE_KEY, JSON.stringify({
    ...config,
    createdAt: Date.now()
  }));
}

function clearPendingDatasetUpload(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(DATASET_UPLOAD_PENDING_STORAGE_KEY);
}

function cameraConfigValue(form: FormState, cameraCount: number, required = false) {
  const entries = form.cameras
    .slice(0, cameraCount)
    .map((camera, index) => ({ camera, index }))
    .filter(({ camera }) => camera.id.trim())
    .map(({ camera, index }) => {
      const label = cameraLabels[index] ?? "Camera 0";
      const name = requireValue(camera.name, `${label} name`, cameraConfigField(index, "Name"));
      const width = requireNumber(camera.width, `${label} width`, { integer: true, min: 1 }, cameraConfigField(index, "Width"));
      const height = requireNumber(camera.height, `${label} height`, { integer: true, min: 1 }, cameraConfigField(index, "Height"));
      const fps = requireNumber(camera.fps, `${label} fps`, { min: Number.MIN_VALUE }, cameraConfigField(index, "Fps"));
      return `${cameraNameKey(name)}: {type: opencv, index_or_path: ${cameraRef(camera.id)}, width: ${width}, height: ${height}, fps: ${fps}}`;
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

function alignFormWithRunningInferenceJob(form: FormState, job: InferenceJob): FormState {
  const serverAddress = inferenceJobServerAddress(job);
  if (!serverAddress) {
    throw new Error(`Inference job #${job.id} 还没有服务地址，请等 Inference 页面显示服务地址后再运行 Infer。`);
  }
  if (!job.checkpointPath) {
    throw new Error(`Inference job #${job.id} 还没有模型路径，请等 Inference 页面显示模型路径后再运行 Infer。`);
  }
  return {
    ...form,
    inferServerAddress: serverAddress,
    inferPretrainedNameOrPath: job.checkpointPath
  };
}

const lerobotModules: Record<string, string> = {
  "lerobot-calibrate": "lerobot.scripts.lerobot_calibrate",
  "lerobot-find-cameras": "lerobot.scripts.lerobot_find_cameras",
  "lerobot-find-port": "lerobot.scripts.lerobot_find_port",
  "lerobot-info": "lerobot.scripts.lerobot_info",
  "lerobot-record": "lerobot.scripts.lerobot_record",
  "lerobot-robot-client": "lerobot.async_inference.robot_client",
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
    case "save-pose":
      return [
        bundledScriptCommand(status, "robotcloud_save_pose.py", dialect, quote),
        "--robot.type=so101_follower",
        `--robot.port=${quote(followerPort())}`,
        `--robot.id=${quote(robotId())}`,
        // `--robot.max_relative_target=${DEFAULT_MAX_RELATIVE_TARGET}`,
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
        // `record-auto` action: min/max/stationary episode time instead of episode/reset seconds.
        const minEpisodeTimeS = requireNumber(form.minEpisodeTimeS, "Min episode seconds", { min: Number.MIN_VALUE });
        const maxEpisodeTimeS = requireNumber(form.maxEpisodeTimeS, "Max episode seconds", { min: Number.MIN_VALUE });
        const stationaryHoldTimeS = requireNumber(form.stationaryHoldTimeS, "Stationary action seconds", { min: Number.MIN_VALUE });
        const cameraArg = cameraConfigArg(form, cameraCount, quote, true);
        if (!cameraArg) throw new Error("先配置 Camera 0");
        const parts = [
          bundledScriptCommand(status, "robotcloud_auto_record.py", dialect, quote),
          "--robot.type=so101_follower",
          `--robot.port=${quote(followerPort())}`,
          cameraArg,
          `--robot.id=${quote(robotId())}`,
          //  `--robot.max_relative_target=${DEFAULT_MAX_RELATIVE_TARGET}`,
          "--teleop.type=so101_leader",
          `--teleop.port=${quote(leaderPort())}`,
          `--teleop.id=${quote(teleopId())}`,
          `--dataset.repo_id=${quote(repoId)}`,
          `--dataset.num_episodes=${episodes}`,
          `--dataset.single_task=${quote(requireValue(form.task, "Task label"))}`,
          "--dataset.push_to_hub=false",
          "--dataset.streaming_encoding=true",
          "--dataset.encoder_threads=2",
          "--dataset.rgb_encoder.vcodec=h264",
          `--min_episode_time_s=${minEpisodeTimeS}`,
          `--max_episode_time_s=${maxEpisodeTimeS}`,
          `--stationary_hold_time_s=${stationaryHoldTimeS}`,
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
        // `--robot.max_relative_target=${DEFAULT_MAX_RELATIVE_TARGET}`,
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
        "--dataset.rgb_encoder.vcodec=h264",
        `--dataset.episode_time_s=${episodeTimeS}`,
        `--dataset.reset_time_s=${resetTimeS}`,
      ];
      if (datasetRoot) parts.splice(10, 0, `--dataset.root=${quote(datasetRoot)}`);
      return parts.join(" ");
    }
    case "infer": {
      const cameraArg = cameraConfigArg(form, cameraCount, quote, true);
      if (!cameraArg) throw new Error("先配置 Camera 0");
      return [
        lerobotCommand(status, "lerobot-robot-client"),
        `--server_address=${quote(requireInferenceServerAddress(form.inferServerAddress, "Server address"))}`,
        "--robot.type=so101_follower",
        `--robot.port=${quote(followerPort())}`,
        `--robot.id=${quote(robotId())}`,
        cameraArg,
        `--task=${quote(requireValue(form.task, "Task label"))}`,
        `--policy_type=${quote(requireValue(form.inferPolicyType, "Policy type"))}`,
        `--policy_device=${quote(requireValue(form.inferPolicyDevice, "Policy device"))}`,
        `--pretrained_name_or_path=${quote(requireValue(form.inferPretrainedNameOrPath, "Pretrained name or path"))}`,
        `--actions_per_chunk=${requireNumericText(form.inferActionsPerChunk, "Actions per chunk", { integer: true, min: 1 })}`,
        `--chunk_size_threshold=${requireNumericText(form.inferChunkSizeThreshold, "Chunk size threshold", { min: 0 })}`,
        `--aggregate_fn_name=${quote(requireValue(form.inferAggregateFnName, "Aggregate function"))}`,
        "--debug_visualize_queue_size=True"
      ].join(" ");
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
  buildPrepareUploadCommand,
  CLEAR_CURRENT_TERMINAL_INPUT,
  RUNTIME_UPDATE_COMMAND,
  PREPARE_UPLOAD_COMMAND,
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

function formatRuntimeProgressLogLine(progress: RuntimeProgressEvent) {
  const lines = [progress.message];
  if (progress.command) {
    lines.push(`$ ${progress.command}`);
  }
  const output = progress.output?.trimEnd();
  if (output) {
    lines.push(`[${progress.stream ?? "output"}]`);
    lines.push(output);
  }
  return lines.join("\n");
}

function writeRuntimeProgressLogToTerminal(term: TerminalHandle, lines: string[]) {
  if (lines.length === 0) return;
  term.write("RobotCloud runtime preparation log:\r\n");
  for (const line of lines) {
    term.write(`${line.replace(/\r?\n/g, "\r\n")}\r\n`);
  }
  term.write("\r\n");
}

const persistentTerminalStore: {
  term: TerminalHandle | null;
  sessionId: string | null;
  shell: string | null;
  phase: TerminalPhase;
  error: string | null;
  runtimeProgress: RuntimeProgressEvent | null;
  runtimeProgressLog: string[];
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
  runtimeProgressLog: [],
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
    runtimeProgress: persistentTerminalStore.runtimeProgress,
    runtimeProgressLog: [...persistentTerminalStore.runtimeProgressLog]
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
  if (phase !== "preparing" && phase !== "failed") {
    persistentTerminalStore.runtimeProgress = null;
    persistentTerminalStore.runtimeProgressLog = [];
  }
  notifyPersistentTerminalListeners();
}

function setPersistentTerminalError(error: string | null) {
  persistentTerminalStore.error = error;
  notifyPersistentTerminalListeners();
}

function setPersistentRuntimeProgress(progress: RuntimeProgressEvent | null) {
  persistentTerminalStore.runtimeProgress = progress;
  if (progress) {
    const line = formatRuntimeProgressLogLine(progress);
    const previous = persistentTerminalStore.runtimeProgressLog[persistentTerminalStore.runtimeProgressLog.length - 1];
    if (line && line !== previous) {
      persistentTerminalStore.runtimeProgressLog = [
        ...persistentTerminalStore.runtimeProgressLog,
        line
      ].slice(-MAX_RUNTIME_PROGRESS_LOG);
    }
  }
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
  persistentTerminalStore.runtimeProgressLog = [];
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
    const runtimeStartupLog = [...persistentTerminalStore.runtimeProgressLog];
    setPersistentTerminalState("starting", null);
    const [{ Terminal }, reusableSession] = await Promise.all([
      import("@xterm/xterm"),
      bridge.terminal.current ? bridge.terminal.current().catch(() => null) : Promise.resolve(null)
    ]);
    const session = reusableSession ?? await bridge.terminal.start();
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
    writeRuntimeProgressLogToTerminal(term, runtimeStartupLog);
    term.write(`RobotCloud terminal: ${session.shell}\r\n`);
    if (session.replay) {
      term.write(session.replay);
    }
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
      const message = messageFromUnknownError(error);
      setPersistentRuntimeProgress({
        phase: "failed",
        message,
        current: null,
        total: null
      });
      setPersistentTerminalState("failed", message);
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
  persistentTerminalStore.runtimeProgressLog = [];
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
  const [showResult, setShowResult] = useState(false);
  const resultPhase = state.phase === "valid" || state.phase === "invalid" ? state.phase : null;
  const resultVisible = Boolean(resultPhase && showResult);
  const isChecking = state.phase === "checking";
  const buttonAriaLabel = state.phase === "checking"
    ? "Checking"
    : resultVisible
      ? resultPhase === "valid" ? "Check passed" : "Check failed"
      : "Check";
  const resultClass = resultVisible
    ? resultPhase === "valid"
      ? "border-green-500/60 text-green-400"
      : "border-red-500/60 text-red-400"
    : "border-theme accent-text";

  useEffect(() => {
    if (!resultPhase) {
      setShowResult(false);
      return;
    }
    setShowResult(true);
    const timer = setTimeout(() => setShowResult(false), 3000);
    return () => clearTimeout(timer);
  }, [resultPhase, state]);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || state.phase === "checking"}
      aria-label={buttonAriaLabel}
      title={resultVisible && state.message ? state.message : buttonAriaLabel}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-xs font-semibold transition hover:accent-bg disabled:cursor-not-allowed disabled:opacity-50 ${resultClass}`}
    >
      {isChecking ? (
        <SpinnerIcon className="h-4 w-4 animate-spin" />
      ) : resultVisible ? (
        <span aria-hidden="true" className="text-base leading-none">{resultPhase === "valid" ? "✓" : "×"}</span>
      ) : (
        <ValidateIcon className="h-4 w-4" />
      )}
    </button>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

function ValidateIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M9 12.5l2 2 4-5" />
      <path d="M12 21a9 9 0 1 0-9-9 9 9 0 0 0 9 9Z" />
    </svg>
  );
}

function PreviewIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
    </svg>
  );
}

function RuntimeUpdateIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M21 12a9 9 0 0 1-15.4 6.4" />
      <path d="M3 12A9 9 0 0 1 18.4 5.6" />
      <path d="M18 2v4h-4" />
      <path d="M6 22v-4h4" />
    </svg>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

export function SO101Client() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const locale = useLocaleStore((state) => state.locale);
  const desktopBridgeAvailability = useDesktopBridgeAvailability();
  const copy = useMemo(
    () =>
      locale === "zh"
        ? {
            recorderModeLabel: "使用 LeRobot 原版录制工具（不勾选则用 RobotCloud 自动录制，动作静止达到设定时间后自动切分下一条）",
            versionTitle: "版本",
            builtInLerobot: "内置 LeRobot",
            appVersion: "应用版本",
            buildCommit: "构建提交",
            buildTime: "构建时间",
            updateRuntime: "更新 LeRobot 环境",
            updatingRuntime: "正在更新 LeRobot 环境"
          }
        : {
            recorderModeLabel:
              "Use the original LeRobot recorder (unchecked uses RobotCloud auto recording and starts the next episode after the action stays still for the configured time)",
            versionTitle: "Version",
            builtInLerobot: "Built-in LeRobot",
            appVersion: "App version",
            buildCommit: "Build commit",
            buildTime: "Build time",
            updateRuntime: "Update LeRobot runtime",
            updatingRuntime: "Updating LeRobot runtime"
          },
    [locale]
  );
  const [initialConnection] = useState(() => readLocalConnectionSettings());
  const [form, setForm] = useState<FormState>(initialConnection.form);
  const [cameraCount, setCameraCount] = useState(initialConnection.cameraCount);
  const [connectionLoaded, setConnectionLoaded] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(true);
  const [selectedAction, setSelectedAction] = useState<ActionId | null>(null);
  const [activeRightPanelCard, setActiveRightPanelCard] = useState<RightPanelCardId>("commands");
  const [uploadPreparing, setUploadPreparing] = useState(() => Boolean(readPendingDatasetUpload()));
  const [runtimeUpdating, setRuntimeUpdating] = useState(false);
  const [actionConfigError, setActionConfigError] = useState<ActionConfigError | null>(null);
  const [highlightedField, setHighlightedField] = useState<ConfigFieldId | null>(null);
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [terminalState, setTerminalState] = useState<TerminalStoreSnapshot>(() => persistentTerminalSnapshot());
  const [terminalContainerEl, setTerminalContainerEl] = useState<HTMLDivElement | null>(null);
  const configInputRefs = useRef<Partial<Record<ConfigFieldId, HTMLInputElement | null>>>({});
  const rightPanelRef = useRef<HTMLElement | null>(null);
  const rightPanelNavRef = useRef<HTMLElement | null>(null);
  const rightPanelCardRefs = useRef<Partial<Record<RightPanelCardId, HTMLElement | null>>>({});
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runtimeUpdateProgressOffRef = useRef<(() => void) | null>(null);
  const uploadCommandPendingRef = useRef(uploadPreparing);
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
  const connectionDirtyRef = useRef(false);
  const terminalPhase = terminalState.phase;
  const terminalError = terminalState.error;
  const runtimeProgress = terminalState.runtimeProgress;
  const runtimeProgressLog = terminalState.runtimeProgressLog;
  const runtimePercent = runtimeProgressPercent(runtimeProgress);
  const showRuntimeProgress = terminalPhase === "preparing" || (terminalPhase === "failed" && runtimeProgressLog.length > 0);
  const bridgeReady = desktopBridgeAvailability === "available";
  const registerConfigInput = (field: ConfigFieldId) => (node: HTMLInputElement | null) => {
    configInputRefs.current[field] = node;
  };
  const registerRightPanelCard = (card: RightPanelCardId) => (node: HTMLElement | null) => {
    rightPanelCardRefs.current[card] = node;
  };
  const jumpToRightPanelCard = (card: RightPanelCardId) => {
    setActiveRightPanelCard(card);
    rightPanelCardRefs.current[card]?.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
  };
  const syncRightPanelCardFromScroll = useCallback(() => {
    const panel = rightPanelRef.current;
    if (!panel) return;
    const navBottom = rightPanelNavRef.current?.getBoundingClientRect().bottom;
    const currentLine = (navBottom ?? panel.getBoundingClientRect().top) + 8;
    let next: RightPanelCardId = rightPanelNavItems[0].id;

    for (const item of rightPanelNavItems) {
      const node = rightPanelCardRefs.current[item.id];
      if (node && node.getBoundingClientRect().top <= currentLine) {
        next = item.id;
      }
    }

    setActiveRightPanelCard((current) => (current === next ? current : next));
  }, []);
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
      if (shouldUseLocalDesktopNavigation()) {
        router.replace("/login?next=%2Fso101");
      } else {
        navigateToCloudPath("/login?next=%2Fso101");
      }
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
      runtimeUpdateProgressOffRef.current?.();
      runtimeUpdateProgressOffRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (bridgeReady && window.robotcloudDesktop?.so101.getSettings) {
      let cancelled = false;
      readDesktopConnectionSettings(window.robotcloudDesktop)
        .then((saved) => {
          if (cancelled) return;
          if (saved.raw) {
            writeLocalConnectionSettings(saved.raw);
          }
          if (saved.raw && !connectionDirtyRef.current) {
            setForm(saved.form);
            setCameraCount(saved.cameraCount);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) {
            setConnectionLoaded(true);
          }
        });
      return () => {
        cancelled = true;
      };
    }

    if (desktopBridgeAvailability !== "checking") {
      setConnectionLoaded(true);
    }
  }, [bridgeReady, desktopBridgeAvailability]);

  useEffect(() => {
    if (!connectionLoaded) return;
    const serialized = serializeConnectionSettings(form, cameraCount);
    writeLocalConnectionSettings(serialized);
    writeDesktopConnectionSettings(serialized);
  }, [cameraCount, connectionLoaded, form]);

  useEffect(() => {
    if (token && desktopBridgeAvailability === "unavailable") {
      router.replace("/");
    }
  }, [desktopBridgeAvailability, router, token]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let frame: number | null = null;
    const requestFrame = (callback: FrameRequestCallback) => (
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(callback)
        : window.setTimeout(() => callback(Date.now()), 0)
    );
    const cancelFrame = (handle: number) => {
      if (typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(handle);
      } else {
        window.clearTimeout(handle);
      }
    };
    const scheduleSync = () => {
      if (frame != null) return;
      let didRun = false;
      const nextFrame = requestFrame(() => {
        didRun = true;
        frame = null;
        syncRightPanelCardFromScroll();
      });
      frame = didRun ? null : nextFrame;
    };

    scheduleSync();
    window.addEventListener("scroll", scheduleSync, { passive: true });
    window.addEventListener("resize", scheduleSync);
    return () => {
      if (frame != null) {
        cancelFrame(frame);
      }
      window.removeEventListener("scroll", scheduleSync);
      window.removeEventListener("resize", scheduleSync);
    };
  }, [syncRightPanelCardFromScroll]);

  const updateField = <K extends keyof Omit<FormState, "cameras">>(key: K, value: FormState[K]) => {
    connectionDirtyRef.current = true;
    setForm((current) => ({ ...current, [key]: value }));
    if (isConfigFieldId(String(key))) {
      clearConfigErrorForField(String(key) as ConfigFieldId);
    }
    if (key === "followerPort" || key === "leaderPort") {
      setPortChecks((current) => ({ ...current, [key]: idleCheck }));
    }
  };

  const updateCamera = <K extends keyof CameraForm>(index: number, key: K, value: CameraForm[K]) => {
    connectionDirtyRef.current = true;
    setForm((current) => {
      const cameras = [...current.cameras] as [CameraForm, CameraForm, CameraForm];
      cameras[index] = { ...cameras[index], [key]: value };
      return { ...current, cameras };
    });
    clearConfigErrorForField(cameraConfigField(
      index,
      key === "name" ? "Name" : key === "id" ? "Id" : key === "width" ? "Width" : key === "height" ? "Height" : "Fps"
    ));
    setCameraChecks((current) => {
      const next = [...current] as [CheckState, CheckState, CheckState];
      next[index] = idleCheck;
      return next;
    });
  };

  const addCamera = () => {
    const nextCount = Math.min(MAX_CAMERAS, cameraCount + 1);
    if (nextCount === cameraCount) return;
    connectionDirtyRef.current = true;
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
    connectionDirtyRef.current = true;
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
      setRobotCloudApiBaseUrl(null);
      setStatus({
        isDesktop: false,
        platform: "browser",
        appVersion: "browser",
        appBuildCommit: "unknown",
        appBuildTime: "unknown",
        lerobotVersion: null,
        bundledLerobotVersion: null,
        lerobotUpdateAvailable: false,
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
    const desktopStatus = await window.robotcloudDesktop.status();
    setRobotCloudApiBaseUrl(desktopStatus.apiBaseUrl);
    setStatus(desktopStatus);
  }, []);

  const writeTerminalCommand = useCallback(async (
    command: string,
    options: { focusTerminal?: boolean; submit?: boolean } = {}
  ) => {
    const sessionId = persistentTerminalStore.sessionId;
    if (!sessionId || !window.robotcloudDesktop) {
      throw new Error("Terminal is not ready.");
    }
    const suffix = options.submit ? "\r" : "";
    await window.robotcloudDesktop.terminal.write(sessionId, `${CLEAR_CURRENT_TERMINAL_INPUT}${command}${suffix}`);
    if (options.focusTerminal) {
      persistentTerminalStore.term?.focus();
    }
  }, []);

  const updateRuntime = useCallback(async () => {
    const bridge = window.robotcloudDesktop;
    const runtimeBridge = bridge?.runtime;
    if (!runtimeBridge?.update) return;

    runtimeUpdateProgressOffRef.current?.();
    runtimeUpdateProgressOffRef.current = null;
    setRuntimeUpdating(true);
    setPersistentTerminalError(null);
    let offProgress: (() => void) | null = null;
    const finishUpdating = () => {
      offProgress?.();
      if (runtimeUpdateProgressOffRef.current === offProgress) {
        runtimeUpdateProgressOffRef.current = null;
      }
      setRuntimeUpdating(false);
    };
    offProgress = runtimeBridge.onProgress?.((event) => {
      if (event.phase === "ready") {
        refreshStatus()
          .catch((error) => setPersistentTerminalError(messageFromUnknownError(error)))
          .finally(finishUpdating);
      } else if (event.phase === "failed") {
        setPersistentTerminalError(event.message);
        finishUpdating();
      }
    }) ?? null;
    runtimeUpdateProgressOffRef.current = offProgress;
    try {
      await writeTerminalCommand(RUNTIME_UPDATE_COMMAND, { focusTerminal: true, submit: true });
      if (!offProgress) {
        setRuntimeUpdating(false);
      }
    } catch (error) {
      offProgress?.();
      if (runtimeUpdateProgressOffRef.current === offProgress) {
        runtimeUpdateProgressOffRef.current = null;
      }
      setRuntimeUpdating(false);
      setPersistentTerminalError(messageFromUnknownError(error));
    }
  }, [refreshStatus, writeTerminalCommand]);

  useEffect(() => {
    if (!token || !bridgeReady) return;
    refreshStatus().catch((error) => setPersistentTerminalError(messageFromUnknownError(error)));
  }, [bridgeReady, refreshStatus, token]);

  useEffect(() => {
    if (!token || !bridgeReady || !window.robotcloudDesktop || !terminalContainerEl) return;
    ensurePersistentTerminal(window.robotcloudDesktop, terminalContainerEl, {
      onRuntimePrepared: () => refreshStatus().catch((error) => setPersistentTerminalError(messageFromUnknownError(error)))
    });
    return () => {
      if (persistentTerminalStore.host === terminalContainerEl) {
        persistentTerminalStore.host = null;
      }
      disconnectPersistentTerminalResize();
    };
  }, [bridgeReady, refreshStatus, terminalContainerEl, token]);

  const finishPreparedDatasetUpload = useCallback((prepared: PreparedDatasetUpload) => {
    if (!uploadCommandPendingRef.current && !readPendingDatasetUpload()) return;
    uploadCommandPendingRef.current = false;
    clearPendingDatasetUpload();
    setUploadPreparing(false);
    setPersistentTerminalError(null);
    void writePreparedDatasetUpload(prepared)
      .then(() => {
        if (shouldUseLocalDesktopNavigation()) {
          router.push("/datasets?source=so101");
        } else {
          navigateToCloudPath("/datasets?source=so101");
        }
      })
      .catch((error) => {
        setPersistentTerminalError(messageFromUnknownError(error));
      });
  }, [router]);

  useEffect(() => {
    if (!token || !bridgeReady) return;
    const datasetBridge = window.robotcloudDesktop?.dataset;
    const onPreparedUpload = datasetBridge?.onPreparedUpload;
    const onPrepareUploadError = datasetBridge?.onPrepareUploadError;
    if (!onPreparedUpload || !onPrepareUploadError) return;

    let cancelled = false;
    const pendingUpload = readPendingDatasetUpload();
    uploadCommandPendingRef.current = Boolean(pendingUpload);
    if (pendingUpload) {
      setUploadPreparing(true);
      datasetBridge.getPreparedUpload?.()
        .then((prepared) => {
          if (!cancelled && prepared) {
            finishPreparedDatasetUpload(prepared);
          }
        })
        .catch(() => undefined);
    }

    const offPreparedUpload = onPreparedUpload((prepared) => {
      finishPreparedDatasetUpload(prepared);
    });

    const offPrepareUploadError = onPrepareUploadError((event) => {
      if (!uploadCommandPendingRef.current && !readPendingDatasetUpload()) return;
      uploadCommandPendingRef.current = false;
      clearPendingDatasetUpload();
      setUploadPreparing(false);
      setPersistentTerminalError(event.message);
    });

    return () => {
      cancelled = true;
      offPreparedUpload();
      offPrepareUploadError();
    };
  }, [bridgeReady, finishPreparedDatasetUpload, token]);

  const writeActionCommand = useCallback(async (
    action: ActionId,
    options: { force?: boolean; formOverride?: FormState; submit?: boolean } = {}
  ) => {
    const commandForm = options.formOverride ?? form;
    const command = buildActionCommand(action, commandForm, status, cameraCount);
    if (!options.force && command === lastWrittenActionCommandRef.current) return;
    lastWrittenActionCommandRef.current = command;
    try {
      await writeTerminalCommand(command, { focusTerminal: options.force, submit: options.submit });
    } catch (error) {
      if (lastWrittenActionCommandRef.current === command) {
        lastWrittenActionCommandRef.current = null;
      }
      throw error;
    }
  }, [cameraCount, form, status, writeTerminalCommand]);

  const resolveInferActionForm = async () => {
    if (status?.apiBaseUrl) {
      setRobotCloudApiBaseUrl(status.apiBaseUrl);
    }
    const jobs = await robotCloudApi.fetchInferenceJobs();
    const runningJob = selectCurrentRunningInferenceJob(jobs);
    if (!runningJob) {
      const activeJob = selectCurrentActiveInferenceJob(jobs);
      if (activeJob) {
        throw new Error(`Inference job #${activeJob.id} 当前是 ${activeJob.status}，请等 Inference 页面显示 running 和服务地址后再运行 Infer。`);
      }
      throw new Error("没有 active inference job。请先在 Inference 页面启动推理任务，并等待状态变为 running。");
    }
    return alignFormWithRunningInferenceJob(form, runningJob);
  };

  const runAction = async (action: ActionId, options: { submit?: boolean } = {}) => {
    try {
      setPersistentTerminalError(null);
      setActionConfigError(null);
      if (action === "infer") {
        const alignedForm = await resolveInferActionForm();
        connectionDirtyRef.current = true;
        setForm(alignedForm);
        setSelectedAction(action);
        await writeActionCommand(action, { force: true, formOverride: alignedForm, submit: options.submit });
        return;
      }
      setSelectedAction(action);
      await writeActionCommand(action, { force: true, submit: options.submit });
    } catch (error) {
      if (handleConfigValidationError(error)) return;
      setPersistentTerminalError(messageFromUnknownError(error));
    }
  };

  useEffect(() => {
    if (!selectedAction || terminalPhase !== "ready") return;
    let cancelled = false;
    writeActionCommand(selectedAction).catch((error) => {
      if (cancelled || configValidationErrorFrom(error)) return;
      setPersistentTerminalError(messageFromUnknownError(error));
    });
    return () => {
      cancelled = true;
    };
  }, [selectedAction, terminalPhase, writeActionCommand]);

  const startDatasetUploadFromTerminal = async () => {
    try {
      const datasetBridge = window.robotcloudDesktop?.dataset;
      if (!datasetBridge) {
        throw new Error("Desktop dataset bridge is not ready.");
      }
      if (!datasetBridge.onPreparedUpload || !datasetBridge.onPrepareUploadError) {
        throw new Error("Desktop app needs to be updated before terminal upload is available.");
      }
      const datasetRepoId = requireValue(form.datasetRepoId, "Dataset repo id");
      const datasetRoot = requireValue(resolvedDatasetRoot(form, status), "Dataset root");
      setUploadPreparing(true);
      setActionConfigError(null);
      setPersistentTerminalError(null);
      const uploadConfig = {
        datasetRoot,
        datasetRepoId,
        task: form.task
      };
      writePendingDatasetUpload(uploadConfig);
      uploadCommandPendingRef.current = true;
      await writeTerminalCommand(buildPrepareUploadCommand(uploadConfig, status), { focusTerminal: true, submit: true });
    } catch (error) {
      uploadCommandPendingRef.current = false;
      clearPendingDatasetUpload();
      setUploadPreparing(false);
      if (handleConfigValidationError(error)) return;
      setPersistentTerminalError(messageFromUnknownError(error));
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
        [key]: { phase: "invalid", message: messageFromUnknownError(error) }
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
      const requestedWidth = cameraValidationValue(camera.width);
      const requestedHeight = cameraValidationValue(camera.height);
      const requestedFps = requestedWidth > 0 && requestedHeight > 0 ? cameraValidationValue(camera.fps) : 0;
      const result = await window.robotcloudDesktop.so101.validateCamera(
        camera.id,
        requestedWidth,
        requestedHeight,
        requestedFps
      );
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
        next[index] = { phase: "invalid", message: messageFromUnknownError(error) };
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
        next[index] = { phase: "invalid", message: messageFromUnknownError(error) };
        return next;
      });
    } finally {
      setPreviewingCamera(null);
    }
  };

  const runtimeUpdateAvailable = Boolean(
    status?.lerobotUpdateAvailable &&
    bridgeReady &&
    typeof window !== "undefined" &&
    window.robotcloudDesktop?.runtime?.update
  );
  const runtimeDetail = useMemo(() => {
    const path = status?.runtimeError ?? status?.runtimePath ?? "not found";
    const versions = [
      status?.lerobotVersion ? `current ${status.lerobotVersion}` : null,
      status?.bundledLerobotVersion ? `bundled ${status.bundledLerobotVersion}` : null
    ].filter(Boolean);
    return versions.length > 0 ? `${path} · ${versions.join(" · ")}` : path;
  }, [status]);
  const runtimeStatusCards = useMemo(
    () => [
      { key: "runtime", label: "Runtime", value: status?.runtimeReady ? "ready" : "missing", detail: runtimeDetail },
      { key: "data", label: "Data folder", value: "local", detail: status?.dataDir || "pending" }
    ],
    [runtimeDetail, status]
  );
  const versionDetails = useMemo(
    () => [
      { label: copy.builtInLerobot, value: versionText(status?.lerobotVersion) },
      { label: copy.appVersion, value: versionText(status?.appVersion) },
      { label: copy.buildCommit, value: versionText(status?.appBuildCommit) },
      { label: copy.buildTime, value: versionText(status?.appBuildTime) }
    ],
    [copy.appVersion, copy.buildCommit, copy.buildTime, copy.builtInLerobot, status]
  );
  const selectedActionDefinition = selectedAction ? actionDefinitionById[selectedAction] : null;
  const selectedConfigSections = useMemo(
    () => new Set<ConfigSectionId>(selectedActionDefinition?.sections ?? []),
    [selectedActionDefinition]
  );
  const configCardClass = (section: ConfigSectionId) => {
    const selectedClass = selectedConfigSections.has(section)
      ? "border-primary/70 shadow-[0_0_0_1px_rgba(59,130,246,0.18)]"
      : "border-theme";
    return `scroll-mt-14 rounded-lg border ${selectedClass} bg-card p-4`;
  };
  const rightPanelNavButtonClass = (card: RightPanelCardId) => {
    const activeClass = activeRightPanelCard === card ? "text-zinc-200" : "text-zinc-500 hover:text-zinc-300";
    return `group relative flex h-7 min-w-0 flex-1 items-center px-1 transition ${activeClass}`;
  };
  const rightPanelNavLineClass = (card: RightPanelCardId) => {
    const activeClass = activeRightPanelCard === card ? "h-1.5" : "h-px group-hover:h-1";
    return `block w-full rounded-full bg-current transition-all ${activeClass}`;
  };
  const actionButtonClass = (actionId: ActionId) => {
    const selectedClass = selectedAction === actionId ? "border-primary bg-surface" : "border-theme bg-card";
    return `w-full rounded-md border ${selectedClass} px-3 py-2 text-left text-sm font-semibold accent-text transition hover:border-primary disabled:cursor-not-allowed disabled:opacity-50`;
  };
  const actionRunButtonClass = (actionId: ActionId) => {
    const selectedClass = selectedAction === actionId ? "border-primary bg-surface" : "border-theme bg-card";
    return `flex h-9 w-9 shrink-0 items-center justify-center rounded-md border ${selectedClass} accent-text transition hover:border-primary disabled:cursor-not-allowed disabled:opacity-50`;
  };

  const renderConnectionCard = () => (
    <section ref={registerRightPanelCard("connection")} className={configCardClass("connection")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold accent-text">Connection</h2>
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

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
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
      </div>
    </section>
  );

  const renderCamerasCard = () => (
    <section ref={registerRightPanelCard("cameras")} className={configCardClass("cameras")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold accent-text">Cameras</h2>
      </div>
      <div className="mt-4 grid gap-3">
        {form.cameras.slice(0, cameraCount).map((camera, index) => {
          const nameField = cameraConfigField(index, "Name");
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
                <label className="min-w-[5rem] flex-[0_0_5.5rem] text-sm">
                  <span className="text-muted">Name</span>
                  <input
                    ref={registerConfigInput(nameField)}
                    value={camera.name}
                    onChange={(event) => updateCamera(index, "name", event.target.value)}
                    placeholder={defaultCameraName(index)}
                    className={configInputClass(nameField, "bg-card")}
                    {...configInputA11y(nameField)}
                  />
                  {renderConfigFieldError(nameField)}
                </label>
                <label className="min-w-[10rem] flex-[1_1_10rem] text-sm">
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
                  aria-label={previewingCamera === index ? "Opening preview" : "Preview"}
                  title={previewingCamera === index ? "Opening preview" : "Preview"}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-theme accent-text transition hover:accent-bg disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {previewingCamera === index ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : <PreviewIcon className="h-4 w-4" />}
                </button>
              </div>
              {renderConfigFieldError(idField)}
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <label className="text-xs text-muted">
                  Width
                  <input
                    ref={registerConfigInput(widthField)}
                    {...numericTextInputProps}
                    value={hasCameraProfileValue(camera.width) ? camera.width : ""}
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
                    {...numericTextInputProps}
                    value={hasCameraProfileValue(camera.height) ? camera.height : ""}
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
                    {...numericTextInputProps}
                    value={hasCameraProfileValue(camera.fps) ? camera.fps : ""}
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
  );

  const renderRecordCard = () => (
    <section ref={registerRightPanelCard("record")} className={configCardClass("record")}>
      <h2 className="text-lg font-semibold accent-text">Record</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
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
            {...numericTextInputProps}
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
                {...numericTextInputProps}
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
                {...numericTextInputProps}
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
                {...numericTextInputProps}
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
                {...numericTextInputProps}
                value={form.maxEpisodeTimeS}
                onChange={(event) => updateField("maxEpisodeTimeS", Number(event.target.value))}
                className={configInputClass("maxEpisodeTimeS")}
                {...configInputA11y("maxEpisodeTimeS")}
              />
              {renderConfigFieldError("maxEpisodeTimeS")}
            </label>
            <label className="text-sm">
              <span className="text-muted">Stationary action seconds</span>
              <input
                ref={registerConfigInput("stationaryHoldTimeS")}
                {...numericTextInputProps}
                value={form.stationaryHoldTimeS}
                onChange={(event) => updateField("stationaryHoldTimeS", Number(event.target.value))}
                className={configInputClass("stationaryHoldTimeS")}
                {...configInputA11y("stationaryHoldTimeS")}
              />
              {renderConfigFieldError("stationaryHoldTimeS")}
            </label>
          </>
        )}
        <label className="text-sm md:col-span-2 xl:col-span-1 2xl:col-span-2">
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
        <label className="flex items-center gap-2 text-sm text-muted md:col-span-2 xl:col-span-1 2xl:col-span-2">
          <input
            type="checkbox"
            checked={form.useLerobotRecorder}
            onChange={(event) => updateField("useLerobotRecorder", event.target.checked)}
          />
          {copy.recorderModeLabel}
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={form.displayData} onChange={(event) => updateField("displayData", event.target.checked)} />
          Display LeRobot data windows
        </label>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={startDatasetUploadFromTerminal}
          disabled={uploadPreparing || terminalPhase !== "ready"}
          className="rounded-md gradient-primary px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploadPreparing ? "Packaging..." : "Upload"}
        </button>
      </div>
    </section>
  );

  const renderInferCard = () => (
    <section ref={registerRightPanelCard("infer")} className={configCardClass("infer")}>
      <h2 className="text-lg font-semibold accent-text">Infer</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <label className="text-sm md:col-span-2 xl:col-span-1 2xl:col-span-2">
          <span className="text-muted">server_address</span>
          <input
            ref={registerConfigInput("inferServerAddress")}
            value={form.inferServerAddress}
            onChange={(event) => updateField("inferServerAddress", event.target.value)}
            className={configInputClass("inferServerAddress")}
            {...configInputA11y("inferServerAddress")}
          />
          {renderConfigFieldError("inferServerAddress")}
        </label>
        <label className="text-sm">
          <span className="text-muted">policy_type</span>
          <input
            ref={registerConfigInput("inferPolicyType")}
            value={form.inferPolicyType}
            onChange={(event) => updateField("inferPolicyType", event.target.value)}
            className={configInputClass("inferPolicyType")}
            {...configInputA11y("inferPolicyType")}
          />
          {renderConfigFieldError("inferPolicyType")}
        </label>
        <label className="text-sm">
          <span className="text-muted">policy_device</span>
          <input
            ref={registerConfigInput("inferPolicyDevice")}
            value={form.inferPolicyDevice}
            onChange={(event) => updateField("inferPolicyDevice", event.target.value)}
            className={configInputClass("inferPolicyDevice")}
            {...configInputA11y("inferPolicyDevice")}
          />
          {renderConfigFieldError("inferPolicyDevice")}
        </label>
        <label className="text-sm">
          <span className="text-muted">pretrained_name_or_path</span>
          <input
            ref={registerConfigInput("inferPretrainedNameOrPath")}
            value={form.inferPretrainedNameOrPath}
            onChange={(event) => updateField("inferPretrainedNameOrPath", event.target.value)}
            className={configInputClass("inferPretrainedNameOrPath")}
            {...configInputA11y("inferPretrainedNameOrPath")}
          />
          {renderConfigFieldError("inferPretrainedNameOrPath")}
        </label>
        <label className="text-sm">
          <span className="text-muted">actions_per_chunk</span>
          <input
            ref={registerConfigInput("inferActionsPerChunk")}
            type="text"
            inputMode="numeric"
            value={form.inferActionsPerChunk}
            onChange={(event) => updateField("inferActionsPerChunk", event.target.value)}
            className={configInputClass("inferActionsPerChunk")}
            {...configInputA11y("inferActionsPerChunk")}
          />
          {renderConfigFieldError("inferActionsPerChunk")}
        </label>
        <label className="text-sm">
          <span className="text-muted">chunk_size_threshold</span>
          <input
            ref={registerConfigInput("inferChunkSizeThreshold")}
            type="text"
            inputMode="decimal"
            value={form.inferChunkSizeThreshold}
            onChange={(event) => updateField("inferChunkSizeThreshold", event.target.value)}
            className={configInputClass("inferChunkSizeThreshold")}
            {...configInputA11y("inferChunkSizeThreshold")}
          />
          {renderConfigFieldError("inferChunkSizeThreshold")}
        </label>
        <label className="text-sm md:col-span-2 xl:col-span-1 2xl:col-span-2">
          <span className="text-muted">aggregate_fn_name</span>
          <input
            ref={registerConfigInput("inferAggregateFnName")}
            value={form.inferAggregateFnName}
            onChange={(event) => updateField("inferAggregateFnName", event.target.value)}
            className={configInputClass("inferAggregateFnName")}
            {...configInputA11y("inferAggregateFnName")}
          />
          {renderConfigFieldError("inferAggregateFnName")}
        </label>
      </div>
    </section>
  );

  if (!token) {
    return (
      <main className="flex min-h-[calc(100vh-10rem)] items-center justify-center">
        <section className="w-full max-w-md rounded-lg border border-theme bg-card p-5 text-center">
          <p className="text-sm font-semibold accent-text">Login required</p>
          <p className="mt-2 text-xs text-muted">Redirecting to login before starting SO101.</p>
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
    <main className="grid min-h-[calc(100vh-7rem)] gap-3 xl:h-[calc(100vh-7rem)] xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_25rem] xl:grid-rows-[auto_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,1fr)_28rem]">
      <header className="flex min-h-8 items-center">
        <h1 className="text-2xl font-bold text-body">SO101</h1>
      </header>

      <nav ref={rightPanelNavRef} aria-label="SO101 panel sections" className="sticky top-0 z-20 flex min-h-8 items-center py-1">
        <div className="flex w-full gap-1">
          {rightPanelNavItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => jumpToRightPanelCard(item.id)}
              aria-label={`Show ${item.label} card`}
              title={item.label}
              className={rightPanelNavButtonClass(item.id)}
            >
              <span className={rightPanelNavLineClass(item.id)} />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-full z-30 mt-1 -translate-x-1/2 whitespace-nowrap rounded border border-theme bg-card px-2 py-1 text-[11px] font-semibold text-body opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                {item.label}
              </span>
            </button>
          ))}
        </div>
      </nav>

      <section className="flex min-h-[36rem] flex-col rounded-lg border border-theme bg-card p-4 xl:min-h-0">
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
          </div>
        </div>
        {actionConfigError ? (
          <p role="alert" className="mt-3 rounded-md border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-500">
            {actionConfigError.message}
          </p>
        ) : null}
        {showRuntimeProgress ? (
          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold accent-text">
                {terminalPhase === "failed" ? "LeRobot runtime preparation failed" : "Preparing LeRobot runtime..."}
              </span>
              {terminalPhase === "preparing" && runtimePercent != null ? <span className="text-muted">{runtimePercent}%</span> : null}
            </div>
            {terminalPhase === "preparing" ? (
              <div className="h-2 overflow-hidden rounded bg-surface">
                <div
                  className="h-full gradient-primary transition-all"
                  style={{ width: `${runtimePercent ?? 12}%` }}
                />
              </div>
            ) : null}
            <p className="text-xs text-muted">
              {runtimeProgress?.message ?? "Preparing LeRobot runtime..."}
            </p>
            {runtimeProgressLog.length > 0 ? (
              <div className="max-h-40 overflow-auto rounded-md border border-theme bg-[#07111f] px-3 py-2 font-mono text-[11px] leading-5 text-slate-200">
                {runtimeProgressLog.map((entry, index) => (
                  <pre key={`${index}-${entry.slice(0, 24)}`} className="whitespace-pre-wrap break-words">{entry}</pre>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <div
          ref={terminalContainerRef}
          onClick={() => persistentTerminalStore.term?.focus()}
          className="mt-4 min-h-[28rem] flex-1 overflow-hidden rounded-md border border-theme bg-[#07111f] p-2 xl:min-h-0"
        />
        {terminalError ? <p className="mt-3 text-xs text-red-400">{terminalError}</p> : null}
      </section>

      <aside ref={rightPanelRef} onScroll={syncRightPanelCardFromScroll} className="space-y-4 xl:min-h-0 xl:overflow-y-auto xl:pr-1">
        <section ref={registerRightPanelCard("commands")} className="scroll-mt-14 rounded-lg border border-theme bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold accent-text">Quick Commands</h2>
              {selectedActionDefinition ? (
                <p className="mt-1 truncate text-xs text-muted">{selectedActionDefinition.label}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setActionsOpen((current) => !current)}
              aria-expanded={actionsOpen}
              aria-label="Toggle actions"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-theme text-lg font-semibold accent-text transition hover:accent-bg"
            >
              {actionsOpen ? "-" : "+"}
            </button>
          </div>
          {actionsOpen ? (
            <div className="mt-4 space-y-4">
              {actionGroups.map((group) => (
                <div key={group.label} className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-muted">{group.label}</p>
                  <div className="grid gap-2">
                    {group.actionIds.map((actionId) => {
                      const action = actionDefinitionById[actionId];
                      return (
                        <div key={action.id} className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => runAction(action.id)}
                            disabled={terminalPhase !== "ready"}
                            className={actionButtonClass(action.id)}
                          >
                            {action.label}
                          </button>
                          <button
                            type="button"
                            onClick={() => runAction(action.id, { submit: true })}
                            disabled={terminalPhase !== "ready"}
                            aria-label={`Run ${action.label}`}
                            title={`Run ${action.label}`}
                            className={actionRunButtonClass(action.id)}
                          >
                            <PlayIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        {renderConnectionCard()}
        {renderCamerasCard()}
        {renderRecordCard()}
        {renderInferCard()}

        <section ref={registerRightPanelCard("status")} className="grid scroll-mt-14 gap-3">
          {runtimeStatusCards.map((card) => (
            <div key={card.key} className="rounded-lg border border-theme bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs uppercase tracking-wide text-muted">{card.label}</span>
                <div className="flex items-center gap-2">
                  <span className="rounded border border-theme px-2 py-0.5 text-xs accent-text">{card.value}</span>
                  {card.key === "runtime" && runtimeUpdateAvailable ? (
                    <button
                      type="button"
                      aria-label={runtimeUpdating ? copy.updatingRuntime : copy.updateRuntime}
                      title={runtimeUpdating ? copy.updatingRuntime : copy.updateRuntime}
                      onClick={updateRuntime}
                      disabled={runtimeUpdating || terminalPhase !== "ready"}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-theme accent-text transition hover:accent-bg disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RuntimeUpdateIcon className={`h-4 w-4 ${runtimeUpdating ? "animate-spin" : ""}`} />
                    </button>
                  ) : null}
                </div>
              </div>
              <p className="mt-2 break-all text-xs text-muted">{card.detail}</p>
            </div>
          ))}
        </section>

        <section aria-label="SO101 app version information">
          <div className="rounded-lg border border-theme bg-card p-4">
            <span className="text-xs uppercase tracking-wide text-muted">{copy.versionTitle}</span>
            <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              {versionDetails.map((detail) => (
                <div key={detail.label} className="min-w-0">
                  <dt className="text-xs uppercase tracking-wide text-muted">{detail.label}</dt>
                  <dd className="mt-1 break-all text-sm font-semibold text-body">{detail.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </aside>
    </main>
  );
}
